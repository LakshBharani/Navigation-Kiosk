"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import MapLegend from "./MapLegend";
import AIGuidePanel from "./AIGuidePanel";
import { useAppSettings } from "../context/AppSettingsContext";
import { translations } from "../translations";

//Type for Geoapify autocomplete features
//We create this custom interface because when we want the inputs/outputs
//to be filled in like real maps, we can't use any of the UseState and rather
//need to reference the actually API feature call
interface GeoapifyFeature
{
  type: "Feature";
  properties: {
    formatted: string;
  };
  geometry: {
    type: string;
    coordinates: [number, number];
  };
}

interface ClosureFeature {
  id: number;
  name: string;
  type: string;
  geometry?: {
    type: "Polygon" | "Point";
    coordinates: number[][][] | number[];
  } | null;
  details: {
    "Closure Start Date": string;
    "Closure End Date": string;
    COMMENTS: string;
    "More Information": string;
  };
}

interface MapComponentProps {
  closures?: ClosureFeature[];
}

// Updates map tile label language using MapLibre setLayoutProperty
function updateMapLanguage(map: maplibregl.Map, lang: string) {
  const style = map.getStyle();
  if (!style || !style.layers) return;
  style.layers.forEach((layer) => {
    if (
      layer.type === "symbol" &&
      layer.layout &&
      layer.layout["text-field"]
    ) {
      map.setLayoutProperty(
        layer.id,
        "text-field",
        lang === "en"
          ? ["coalesce", ["get", "name:en"], ["get", "name"]]
          : ["coalesce", ["get", `name:${lang}`], ["get", "name:en"], ["get", "name"]]
      );
    }
  });
}

const MapComponent: React.FC<MapComponentProps> = ({ closures = [] }) => {
  const { language } = useAppSettings();
  const t = translations[language];

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<maplibregl.Map | null>(null);
  //GeoJSON Data that will store the keys of the direction

  const [isMapLoading, setIsMapLoading] = useState(true);
  const [startInput, setStartInput] = useState(""); //Takes userinput for both
  const [endInput, setEndInput] = useState("");
  const [routeLayerId] = useState("route-line"); //maps the distance between the points
  const [startSuggestions, setStartSuggestions] = useState<GeoapifyFeature[]>([]);
  const [endSuggestions, setEndSuggestions] = useState<GeoapifyFeature[]>([]);
  const [aiDirections, setAiDirections] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  //These are the commnads that will outfill the input and outputs of the user for locations

  useEffect(() => {
    //Kiosk location (Goodwin Hall)
    const position = { lat: 37.23244455992258, lng: -80.4256796782161 };

    const initMap = () => {
      if (!mapRef.current) return;

      //Creates the map with MapTiler Cloud style
      const apiKey = process.env.NEXT_PUBLIC_GEO_API_KEY;
      if (!apiKey || apiKey === "") {
        console.error(
          "Geo maps API key is not configured. Please set NEXT_PUBLIC_GEO_API_KEY in your environment variables."
        );
        return null;
      }

      const map = new maplibregl.Map({
        container: mapRef.current,
        style: `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${apiKey}`, //Equivalent to Google 'roadmap'
        center: [position.lng, position.lat],
        zoom: 16,
      });

      mapContainerRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
      map.dragPan.enable(); //Gives the ability to drag across
      map.touchZoomRotate.enableRotation(); //Allows for tilt and rotation

      //Adds the marker point of map
      addMarker(map, position);

      // Map load complete
      map.on("load", () => {
        setIsMapLoading(false);
        map.dragPan.enable();
        // Apply current language to map labels on initial load
        updateMapLanguage(map, language);
      });
    };

    //Load MapLibre GL JS asynchronously if needed (but since imported, init directly)
    initMap();

    //Restarts the map process
    return () => {
      if (mapContainerRef.current)
      {
        mapContainerRef.current.remove();
        mapContainerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update map tile labels whenever language changes (after map is initialized)
  useEffect(() => {
    if (mapContainerRef.current && !isMapLoading) {
      updateMapLanguage(mapContainerRef.current, language);
    }
  }, [language, isMapLoading]);

  // Build a GeoJSON FeatureCollection from closure data
  const buildClosureFC = useCallback((items: ClosureFeature[]) => ({
    type: "FeatureCollection" as const,
    features: items
      .filter((c) => c.geometry)
      .map((c) => ({
        type: "Feature" as const,
        properties: {
          id: c.id,
          name: c.name,
          closureType: c.type,
          startDate: c.details["Closure Start Date"],
          endDate: c.details["Closure End Date"],
          comments: c.details.COMMENTS,
          url: c.details["More Information"],
        },
        geometry: c.geometry!,
      })),
  }), []);

  // Render closure polygons/points on the map
  useEffect(() => {
    const map = mapContainerRef.current;
    if (!map || isMapLoading) return;

    const currentClosures = closures.filter((c) => c.type === "Current");
    const scheduledClosures = closures.filter((c) => c.type === "Scheduled");

    const layerConfigs = [
      { sourceId: "closures-current-source", fillId: "closures-current-fill", outlineId: "closures-current-outline", pointId: "closures-current-points", color: "#B91C1C", data: buildClosureFC(currentClosures) },
      { sourceId: "closures-scheduled-source", fillId: "closures-scheduled-fill", outlineId: "closures-scheduled-outline", pointId: "closures-scheduled-points", color: "#F59E0B", data: buildClosureFC(scheduledClosures) },
    ];

    for (const cfg of layerConfigs) {
      const existing = map.getSource(cfg.sourceId) as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(cfg.data as GeoJSON.FeatureCollection);
      } else {
        map.addSource(cfg.sourceId, { type: "geojson", data: cfg.data as GeoJSON.FeatureCollection });

        map.addLayer({
          id: cfg.fillId,
          type: "fill",
          source: cfg.sourceId,
          filter: ["==", "$type", "Polygon"],
          paint: { "fill-color": cfg.color, "fill-opacity": 0.3 },
        });

        map.addLayer({
          id: cfg.outlineId,
          type: "line",
          source: cfg.sourceId,
          filter: ["==", "$type", "Polygon"],
          paint: { "line-color": cfg.color, "line-width": 2 },
        });

        map.addLayer({
          id: cfg.pointId,
          type: "circle",
          source: cfg.sourceId,
          filter: ["==", "$type", "Point"],
          paint: { "circle-radius": 8, "circle-color": cfg.color, "circle-opacity": 0.6, "circle-stroke-width": 2, "circle-stroke-color": cfg.color },
        });

        // Click popup for polygons and points
        for (const layerId of [cfg.fillId, cfg.pointId]) {
          map.on("click", layerId, (e) => {
            if (!e.features || e.features.length === 0) return;
            const props = e.features[0].properties;
            const urlHtml = props.url && props.url !== "N/A" && props.url !== "null"
              ? `<a href="${props.url}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#1d4ed8">More Info</a>`
              : "";
            new maplibregl.Popup({ maxWidth: "280px" })
              .setLngLat(e.lngLat)
              .setHTML(
                `<div>
                  <strong style="font-size:14px">${props.name}</strong>
                  <p style="margin:4px 0;font-size:13px">${props.comments}</p>
                  <p style="font-size:12px;color:#666">${props.startDate} &mdash; ${props.endDate}</p>
                  ${urlHtml}
                </div>`
              )
              .addTo(map);
          });

          map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
        }
      }
    }
  }, [closures, isMapLoading, buildClosureFC]);

  //This will use the GeoCode import to reference where the coordinate systems are
  //specifically the address
  async function geocodeAddress(query: string): Promise<{ lat: number; lng: number} | null>
  {
    const apikey = process.env.NEXT_PUBLIC_GEO_API_KEY;
    //check to make sure it can still access the key
    if (!apikey)
    {
      console.error("NEXT_PUBLIC_GEO_API_KEY couldn't be set")
      return null;
    }

    //We want to add specific filitering for the map that will only bring up
    //Blacksburg, Virginia Locations for users to route
    const locationBias = `proximity:-80.4256796782161,37.23244455992258`;
    const filterBias = `rect:-80.5,37.15,-80.35,37.3`;
    //Creates a barrier arround the blacksburg locations for filtering

    //Then we update the url to call those when fetching the JSON File format
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&${locationBias}&filter=${filterBias}&apiKey=${apikey}`;

    const res = await fetch(url); //gets the location before calling the json
    const data = await res.json();

    //Returns the position of where its located
    if (data.features && data.features.length > 0)
    {
      const [lng, lat] = data.features[0].geometry.coordinates;
      return {lng, lat};
    }
    return null;
  }

  //Tries to create the route of the locations from the GeoCode API
  //for specific walking routes now
  async function geocodeRoute(start: {lat: number; lng: number }, end: {lat: number; lng: number})
  {
    const apikey = process.env.NEXT_PUBLIC_GEO_API_KEY;
    const url = `https://api.geoapify.com/v1/routing?waypoints=${start.lat},${start.lng}|${end.lat},${end.lng}&mode=walk&apiKey=${apikey}`;

    const res = await fetch(url);
    const data = await res.json();

    return data;
  }

  //Sends route steps to the AI backend for natural language directions
  async function fetchAIDirections(
    origin: string,
    destination: string,
    steps: Array<{ instruction: { text: string }; distance: number }>
  ) {
    setAiLoading(true);
    setAiError(null);
    setAiDirections(null);

    try {
      const backendUrl = process.env.NEXT_PUBLIC_AI_BACKEND_URL || "http://localhost:8000";
      const response = await fetch(`${backendUrl}/api/directions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          destination,
          steps: steps.map((s) => ({
            instruction: s.instruction.text,
            distance: s.distance,
          })),
        }),
      });

      if (!response.ok) throw new Error("AI server error");
      const data = await response.json();

      if (data.success) {
        setAiDirections(data.directions);
      } else {
        setAiError(data.error || "Failed to generate directions");
      }
    } catch {
      setAiError("AI guide unavailable");
    } finally {
      setAiLoading(false);
    }
  }

  //Handles the route pattern of the locations
  async function handleRouting()
  {
    if (!mapContainerRef.current)
    {
      return;
    }

    const map = mapContainerRef.current;

    const start = await geocodeAddress(startInput);
    const end = await geocodeAddress(endInput);

    if (!start || !end)
    {
      alert(t.locationNotFound)
      return;
    }

    const routeData = await geocodeRoute(start, end);
    if (!routeData || !routeData.features || routeData.features.length == 0)
    {
      alert(t.noRouteFound)
      return;
    }
    //Calls the functions respectively for the addresse and route tied to them

    const routeFeature = routeData.features[0]; //Gets the total distance
    //to basically map for the user when they locate two points

    //Remove old route
    if (map.getLayer(routeLayerId))
    {
      map.removeLayer(routeLayerId);
    }
    if (map.getSource(routeLayerId))
    {
      map.removeSource(routeLayerId);
    }

    //Adds the autofill suggestions based on output
    //with the start and end markers in place
    new maplibregl.Marker({ color: "green"})
        .setLngLat([start.lng, start.lat])
        .addTo(map);

    new maplibregl.Marker({color: "red"})
        .setLngLat([end.lng, end.lat])
        .addTo(map);

    //Creates route line
    map.addSource(routeLayerId, {
      type: "geojson",
      data: routeFeature,
    });

    map.addLayer({
      id: routeLayerId,
      type: "line",
      source: routeLayerId,
      paint: {
        "line-color": "#00008b",
        "line-width": 6,
      },
    });

    //rerouting — flatten coordinates if MultiLineString
    const rawCoords = routeFeature.geometry.coordinates;
    const coords: number[][] = Array.isArray(rawCoords[0]?.[0])
      ? rawCoords.flat()
      : rawCoords;
    const bounds = new maplibregl.LngLatBounds();

    coords.forEach((coord: number[]) => {
      bounds.extend(coord as [number, number]);
    });

    //Now we are going to calcualte the distance in meters for the user to see
    //by calling a helper java script method (taken from the interent)
    function formatingDistance
    (
      lat1: number, lon1: number,
      lat2: number, lon2: number
    ): number {

    const R = 6371000; // Earth radius in meters
    const toRad = (x: number) => x * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

    const startPoint = coords[0];
    const endPoint = coords[coords.length - 1];
    const distance = formatingDistance(startPoint[1], startPoint[0],
      endPoint[1], endPoint[0]
    );

    //Then we adjust the map only if the distance can pass some mark
    if (distance > 1000)
    {
        map.fitBounds(bounds, { padding: 60, maxZoom: 20})
    }
    else
    {
        //Centering at the midpoint but keeping the zoom for route
        const midLeft = (startPoint[1] + endPoint[1]) / 2;
        const midRight = (startPoint[0] + endPoint[0]) / 2;
        //The ease to command to tie
        map.easeTo({
          center: [midRight, midLeft],
          zoom: map.getZoom(),
          duration: 1000,
        })
    }

    //Send route steps to AI backend for natural language directions
    const legs = routeFeature.properties?.legs;
    if (legs && legs[0]?.steps) {
      fetchAIDirections(startInput, endInput, legs[0].steps);
    }
  }

  async function autofillInputs(query: string): Promise<GeoapifyFeature[]>
  {
    const apikey = process.env.NEXT_PUBLIC_GEO_API_KEY;
    if (!apikey)
    {
      return[];
    }
    //Making sure that shortened inputs aren't measured in
    if (query.length < 3)
    {
      return[];
    }

    //We do the same thing by adding the bias filtering for the blacksburg locations
    const locationBiasAgain = `proximity:-80.4256796782161,37.23244455992258`;
    const filterBiasAgain = `rect:-80.5,37.15,-80.35,37.3`;

    const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(query)}&limit=5&${locationBiasAgain}&filter=${filterBiasAgain}&apiKey=${apikey}`;
    //Notice how the parsing is done within the API call itself

    const res = await fetch(url);
    const data = await res.json();

    return data.features as GeoapifyFeature[] || [];

  }

  return (
    <div className="relative flex flex-col h-full bg-text-black-200">
      {isMapLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
          <p>{t.loadingMap}</p>
        </div>
      )}

      <div className="absolute top-2 left-2 z-20 bg-white p-2 rounded shadow-md flex flex-col gap-2 w-64">
        <div className="StartRoutingPath">
          <input
            type="text"
            placeholder={t.fromPlaceholder}
            value={startInput}
            onChange={async (e) => {
              setStartInput(e.target.value)
              setStartSuggestions(await autofillInputs(e.target.value));
            }}
            className="text-black border p-1 rounded w-full"
          />
          {startSuggestions.length > 0 && (
            <ul className="absolute bg-white border rounded mt-1 max-h-40 overflow-y-auto w-full shadow-md z-30">
              {startSuggestions.map((s, idx) => (
                <li
                  key={idx}
                  onClick={() => {
                    setStartInput(s.properties.formatted);
                    setStartSuggestions([]);
                  }}
                  className="text-black px-2 py-1 hover:bg-black-100 cursor-pointer"
                >
                  {s.properties.formatted}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="end path routing">
          <input
            type="text"
            placeholder={t.toPlaceholder}
            value={endInput}
            onChange={async (e) => {
              setEndInput(e.target.value)
              setEndSuggestions(await autofillInputs(e.target.value));
            }}
            className="text-black border p-1 rounded w-full"
          />
          {endSuggestions.length > 0 && (
            <ul className="absolute bg-white border rounded mt-1 max-h-40 overflow-y-auto w-full shadow-md z-30">
              {endSuggestions.map((s, idx) => (
                <li
                  key={idx}
                  onClick={() => {
                    setEndInput(s.properties.formatted);  //Autofill word formatting
                    setEndSuggestions([]);
                  }}
                  className="text-black px-2 py-1 hover:bg-black-100 cursor-pointer"
                >
                  {s.properties.formatted}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          onClick={handleRouting}
          className="bg-blue-600 text-white px-3 py-1 rounded" //Routing button
        >
          {t.route}
        </button>
      </div>

      <div ref={mapRef} className="w-full flex-grow" />
      <AIGuidePanel
        directions={aiDirections}
        isLoading={aiLoading}
        error={aiError}
        onDismiss={() => {
          setAiDirections(null);
          setAiError(null);
          setAiLoading(false);
        }}
      />
      <MapLegend />
    </div>
  );
};

export default MapComponent;

//Add a simple marker to the map
function addMarker(map: maplibregl.Map,
  position: { lat: number; lng: number })
{
  const markerElement = document.createElement("div");
  markerElement.style.backgroundColor = "#800020";
  markerElement.style.width = "18px";
  markerElement.style.height = "18px";
  markerElement.style.borderRadius = "50%";
  markerElement.style.border = "2px solid orange";
  markerElement.style.cursor = "pointer";

  new maplibregl.Marker({ element: markerElement })
    .setLngLat([position.lng, position.lat])
    .addTo(map);
}
