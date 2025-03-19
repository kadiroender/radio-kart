import React, { useState, useEffect } from 'react';
import Map from 'pigeon-maps';
import './App.css';

// Default map settings
const DEFAULT_CENTER = [54.0, 10.0]; // Europe center
const DEFAULT_ZOOM = 4; // Zoom level for Europe

function App() {
  // App state
  const [currentStation, setCurrentStation] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [radioStations, setRadioStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [audio] = useState(new Audio());
  const [popularCountries, setPopularCountries] = useState([]);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  useEffect(() => {
    fetchStations();
    fetchPopularCountries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Minimal grayscale map theme
  const mapTiler = (x, y, z) => {
    return `https://tiles.stadiamaps.com/tiles/alidade_smooth/${z}/${x}/${y}.png`;
  };

  // Convert locations to coordinates
  const getStationCoordinates = (station) => {
    if (station.geo_lat && station.geo_long) {
      return {
        ...station,
        latitude: parseFloat(station.geo_lat),
        longitude: parseFloat(station.geo_long),
        position: [parseFloat(station.geo_lat), parseFloat(station.geo_long)]
      };
    } else if (station.country) {
      try {
        // Try to get approximate coordinates for the country
        const countryCoordinates = countryCoords[station.country.toLowerCase()];
        if (countryCoordinates) {
          return {
            ...station,
            latitude: countryCoordinates[0],
            longitude: countryCoordinates[1],
            position: [countryCoordinates[0], countryCoordinates[1]]
          };
        } else {
          // Use a random offset for stations without coordinates to avoid overlapping
          const randomOffset = (Math.random() - 0.5) * 5;
          return {
            ...station,
            latitude: DEFAULT_CENTER[0] + randomOffset,
            longitude: DEFAULT_CENTER[1] + randomOffset,
            position: [DEFAULT_CENTER[0] + randomOffset, DEFAULT_CENTER[1] + randomOffset]
          };
        }
      } catch (error) {
        console.error('Error getting coordinates for:', station.country, error);
        return station;
      }
    } else {
      return station;
    }
  };

  // Fetch radio stations using a more reliable endpoint with randomized server
  const fetchStations = async () => {
    try {
      setLoading(true);
      
      // Get a random API endpoint to distribute load
      const servers = ['de1', 'fr1', 'nl1'];
      const randomServer = servers[Math.floor(Math.random() * servers.length)];
      const apiBase = `https://${randomServer}.api.radio-browser.info/json`;
      
      // Get popular stations with better parameters
      const response = await fetch(
        `${apiBase}/stations/search?limit=1000&hidebroken=true&has_geo_info=true`
      );
      
      if (!response.ok) {
        throw new Error(`API responded with status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Fetched stations:', data.length);
      
      // Format station data
      const formattedStations = data
        .filter(station => station.url_resolved && station.name)
        .map(station => ({
          id: station.stationuuid || Math.random().toString(36).substr(2, 9),
          name: station.name || '',
          url: station.url_resolved || station.url || '',
          country: station.country || '',
          city: station.state || station.city || '',
          favicon: station.favicon || `https://ui-avatars.com/api/?name=${encodeURIComponent(station.name)}&background=random&color=fff&size=50`,
          tags: station.tags ? 
            (Array.isArray(station.tags) ? station.tags : station.tags.split(',').map(tag => tag.trim())) 
            : [],
          language: station.language || '',
          votes: station.votes || 0,
          clickcount: station.clickcount || 0,
          geo_lat: station.geo_lat,
          geo_long: station.geo_long
        }))
        .map(getStationCoordinates)
        .filter(station => station.position); // Only include stations with valid coordinates
      
      setRadioStations(formattedStations);
      setError(null);
    } catch (err) {
      console.error('Error fetching stations:', err);
      setError('Radyo istasyonları yüklenirken bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch popular countries to suggest to the user
  const fetchPopularCountries = async () => {
    try {
      const response = await fetch('https://de1.api.radio-browser.info/json/countries');
      
      if (!response.ok) {
        throw new Error(`API responded with status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Get top 10 countries by station count
      const topCountries = data
        .filter(country => country.name && country.stationcount > 10)
        .sort((a, b) => b.stationcount - a.stationcount)
        .slice(0, 10)
        .map(country => country.name);
        
      setPopularCountries(topCountries);
    } catch (error) {
      console.error('Error fetching countries:', error);
    }
  };

  useEffect(() => {
    const handleAudioError = (e) => {
      console.error('Audio error:', e);
      setIsPlaying(false);
    };

    const handleAudioEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener('error', handleAudioError);
    audio.addEventListener('ended', handleAudioEnded);

    return () => {
      audio.removeEventListener('error', handleAudioError);
      audio.removeEventListener('ended', handleAudioEnded);
      audio.pause();
      audio.src = '';
    };
  }, [audio]);

  const playStation = async (station) => {
    try {
      if (currentStation === station) {
        if (isPlaying) {
          await audio.pause();
        } else {
          await audio.play();
        }
        setIsPlaying(!isPlaying);
      } else {
        await audio.pause();
        audio.src = station.url;
        
        // Report click to the API to improve station rankings
        fetch(`https://de1.api.radio-browser.info/json/url/${station.id}`, { method: 'POST' })
          .catch(err => console.error('Error reporting station click:', err));
          
        await audio.play();
        setCurrentStation(station);
        setIsPlaying(true);
        
        // Center map on the selected station
        if (station.position) {
          setMapCenter(station.position);
          setZoom(5);
        }
      }
    } catch (error) {
      console.error('Playback error:', error);
      setIsPlaying(false);
    }
  };

  const handleSearch = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    
    if (query.trim()) {
      // Find the first matching station
      const matchingStation = radioStations.find(station => 
        station.city.toLowerCase().includes(query.toLowerCase()) ||
        station.country.toLowerCase().includes(query.toLowerCase())
      );
      
      if (matchingStation && matchingStation.position) {
        // Center map on the matching station
        setMapCenter(matchingStation.position);
        setZoom(6); // Zoom level for city view
      }
    } else {
      // Reset to default view if search is cleared
      setMapCenter(DEFAULT_CENTER);
      setZoom(DEFAULT_ZOOM);
    }
  };

  const filteredStations = radioStations.filter(station => {
    if (!searchQuery.trim()) return true;
    
    const searchLower = searchQuery.toLowerCase().trim();
    const searchTerms = searchLower.split(' ').filter(term => term.length > 0);
    
    return searchTerms.every(term => 
      station.name.toLowerCase().includes(term) ||
      station.country.toLowerCase().includes(term) ||
      station.city.toLowerCase().includes(term) ||
      (station.language && station.language.toLowerCase().includes(term)) ||
      (station.tags && station.tags.some(tag => tag.toLowerCase().includes(term)))
    );
  });

  const handleHeaderClick = () => {
    setSearchQuery("");
    if (currentStation) {
      audio.pause();
      setCurrentStation(null);
      setIsPlaying(false);
    }
    
    // Reset map view
    setMapCenter(DEFAULT_CENTER);
    setZoom(DEFAULT_ZOOM);
  };

  const handleCountryClick = (country) => {
    setSearchQuery(country);
    
    // Try to center the map on the country
    const countryCoord = countryCoords[country.toLowerCase()];
    if (countryCoord) {
      setMapCenter(countryCoord);
      setZoom(4);
    }
  };

  // Custom marker component
  const StationMarker = ({ station, onClick }) => {
    const isActive = currentStation === station;
    const clickCount = station.clickcount || 0;
    
    // Calculate color based on click count
    let color;
    if (clickCount > 1000) {
      color = '#ef4444'; // red-500 for most popular
    } else if (clickCount > 500) {
      color = '#f87171'; // red-400
    } else if (clickCount > 100) {
      color = '#fca5a5'; // red-300
    } else {
      color = '#fecaca'; // red-200 for least popular
    }
    
    return (
      <div
        onClick={onClick}
        style={{
          position: 'absolute',
          left: `calc(50% + ${(station.longitude - mapCenter[1]) * 100 * Math.pow(2, zoom - 1)}px)`,
          top: `calc(50% - ${(station.latitude - mapCenter[0]) * 100 * Math.pow(2, zoom - 1)}px)`,
          transform: 'translate(-50%, -50%)',
          cursor: 'pointer',
          zIndex: isActive ? 1000 : 1,
        }}
      >
        <div
          style={{
            width: isActive ? '24px' : '16px',
            height: isActive ? '24px' : '16px',
            backgroundColor: isActive ? '#059669' : color,
            borderRadius: '50%',
            border: '2px solid white',
            boxShadow: '0 0 0 2px rgba(0,0,0,0.2)',
            transition: 'all 0.2s ease',
          }}
          className="hover:scale-125"
        />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Dünya çapında radyo istasyonları yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center text-red-400 p-4">
          <p>{error}</p>
          <button 
            onClick={fetchStations}
            className="mt-4 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            Tekrar Dene
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden">
      {/* World Map */}
      <Map
        center={mapCenter}
        zoom={zoom}
        provider={mapTiler}
        dprs={[1, 2]} // For retina displays
        metaWheelZoom={true}
        animate={true}
        attribution={false} // Remove attribution for cleaner look
        className="absolute inset-0 w-screen h-screen"
        onBoundsChanged={({ center, zoom }) => {
          setMapCenter(center);
          setZoom(zoom);
        }}
      >
        {/* Filter to show a limited number of stations for performance */}
        {filteredStations.slice(0, 500).map(station => (
          station.position ? (
            <StationMarker
              key={station.id}
              station={station}
              onClick={() => {
                setSelectedMarker(station === selectedMarker ? null : station);
              }}
            />
          ) : null
        ))}
        
        {/* Info popup when a station is selected */}
        {selectedMarker && (
          <div 
            style={{
              position: 'absolute',
              left: `calc(50% + ${(selectedMarker.longitude - mapCenter[1]) * 100 * Math.pow(2, zoom - 1)}px)`,
              top: `calc(50% - ${(selectedMarker.latitude - mapCenter[0]) * 100 * Math.pow(2, zoom - 1)}px)`,
              transform: 'translate(-50%, -100%)',
              marginTop: '-20px',
              zIndex: 1000,
            }}
            className="bg-gray-900 bg-opacity-90 p-2 rounded-lg text-white shadow-lg max-w-[200px] backdrop-blur-sm"
          >
            <div className="flex items-center gap-2 mb-1">
              {selectedMarker.favicon && (
                <img 
                  src={selectedMarker.favicon} 
                  alt=""
                  className="w-8 h-8 rounded-full"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedMarker.name)}&background=random&color=fff&size=50`;
                  }}
                />
              )}
              <div>
                <h3 className="font-bold text-sm">{selectedMarker.name}</h3>
                <p className="text-xs opacity-75">
                  {selectedMarker.city && selectedMarker.country 
                    ? `${selectedMarker.city}, ${selectedMarker.country}` 
                    : selectedMarker.country || selectedMarker.city || 'Bilinmeyen Konum'}
                </p>
              </div>
            </div>
            
            <button 
              onClick={(e) => {
                e.stopPropagation();
                playStation(selectedMarker);
              }}
              className="w-full mt-1 p-1 text-xs bg-green-500 hover:bg-green-600 text-white rounded"
            >
              {currentStation === selectedMarker ? (isPlaying ? 'Duraklat' : 'Devam Et') : 'Oynat'}
            </button>
          </div>
        )}
      </Map>
      
      {/* Search Overlay */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 w-11/12 max-w-lg z-10">
        <div className="bg-gray-900 bg-opacity-90 rounded-xl p-2 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-center gap-2 mb-2">
            <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
            </svg>
            <h1 
              onClick={handleHeaderClick}
              className="text-xl font-bold text-center text-green-500 cursor-pointer hover:text-green-400 transition-colors duration-200"
            >
              World Radio
            </h1>
          </div>
          
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Ülke, şehir veya istasyon ara..."
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:border-green-500 focus:ring-0 transition-all duration-200 ease-in-out text-white placeholder-gray-400 text-sm"
              value={searchQuery}
              onChange={handleSearch}
            />
          </div>
          
          {searchQuery.trim() && filteredStations.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto bg-gray-800 rounded-lg p-1">
              {filteredStations.slice(0, 5).map(station => (
                <div
                  key={station.id}
                  className="p-2 rounded-lg cursor-pointer hover:bg-gray-700 text-white text-sm"
                  onClick={() => playStation(station)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="font-medium">{station.name}</span>
                    <span className="text-xs text-gray-400">
                      {station.country || 'Bilinmeyen Ülke'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {!searchQuery.trim() && (
            <div className="flex flex-wrap gap-1 mt-2 justify-center">
              {popularCountries.slice(0, 5).map(country => (
                <button 
                  key={country}
                  onClick={() => handleCountryClick(country)}
                  className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded-full text-xs text-white transition-colors duration-200"
                >
                  {country}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Player Controls Overlay */}
      {currentStation && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-11/12 max-w-lg z-10">
          <div className="bg-gray-900 bg-opacity-90 p-3 rounded-xl shadow-lg backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {currentStation.favicon && (
                  <img 
                    src={currentStation.favicon} 
                    alt={currentStation.name}
                    className="w-10 h-10 rounded-full object-cover bg-gray-700"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentStation.name)}&background=random&color=fff&size=50`;
                    }}
                  />
                )}
                <div>
                  <h2 className="text-sm font-semibold text-white">{currentStation.name}</h2>
                  <p className="text-xs text-gray-300">
                    {currentStation.city && currentStation.country 
                      ? `${currentStation.city}, ${currentStation.country}` 
                      : currentStation.country || currentStation.city || 'Bilinmeyen Konum'}
                  </p>
                </div>
              </div>
              <div>
                <button 
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-green-500 hover:bg-green-600 transition-colors"
                  onClick={() => {
                    if (isPlaying) {
                      audio.pause();
                    } else {
                      audio.play();
                    }
                    setIsPlaying(!isPlaying);
                  }}
                >
                  <span className="text-white text-xl">
                    {isPlaying ? '⏸️' : '▶️'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Common country coordinates for stations without geo data
const countryCoords = {
  "turkey": [39.0, 35.0],
  "united states": [37.0, -95.0],
  "united kingdom": [54.0, -2.0],
  "germany": [51.0, 10.0],
  "france": [46.0, 2.0],
  "italy": [42.0, 12.0],
  "spain": [40.0, -4.0],
  "russia": [60.0, 100.0],
  "china": [35.0, 105.0],
  "japan": [36.0, 138.0],
  "india": [20.0, 77.0],
  "brazil": [-10.0, -55.0],
  "canada": [60.0, -95.0],
  "australia": [-25.0, 135.0],
  "netherlands": [52.1326, 5.2913],
  "sweden": [62.0, 15.0],
  "norway": [62.0, 10.0],
  "finland": [64.0, 26.0],
  "poland": [52.0, 20.0],
  "mexico": [23.0, -102.0],
  "argentina": [-34.0, -64.0],
  "austria": [47.5162, 14.5501],
  "belgium": [50.8333, 4.0],
  "greece": [39.0, 22.0],
  "switzerland": [47.0, 8.0],
  "portugal": [39.5, -8.0],
  "denmark": [56.0, 10.0],
  "ireland": [53.0, -8.0],
  "new zealand": [-40.9006, 174.886],
};

export default App; 