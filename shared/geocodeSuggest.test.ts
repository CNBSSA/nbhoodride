import { describe, it, expect } from "vitest";
import { mapNominatimResults, mapMapboxResults } from "./geocodeSuggest";

describe("mapNominatimResults", () => {
  it("maps display_name + lat/lon to suggestions", () => {
    const raw = [
      { display_name: "3500 East-West Hwy, Hyattsville, MD", lat: "38.968", lon: "-76.955" },
      { display_name: "Largo, MD", lat: "38.88", lon: "-76.83" },
    ];
    expect(mapNominatimResults(raw)).toEqual([
      { label: "3500 East-West Hwy, Hyattsville, MD", lat: 38.968, lng: -76.955 },
      { label: "Largo, MD", lat: 38.88, lng: -76.83 },
    ]);
  });

  it("drops rows with unparseable coords or empty labels", () => {
    const raw = [
      { display_name: "", lat: "38.9", lon: "-76.9" },
      { display_name: "Bad coords", lat: "abc", lon: "-76.9" },
      { display_name: "Good", lat: "38.9", lon: "-76.9" },
    ];
    expect(mapNominatimResults(raw)).toEqual([{ label: "Good", lat: 38.9, lng: -76.9 }]);
  });

  it("returns [] for non-array input", () => {
    expect(mapNominatimResults(null)).toEqual([]);
    expect(mapNominatimResults({})).toEqual([]);
    expect(mapNominatimResults(undefined)).toEqual([]);
  });
});

describe("mapMapboxResults", () => {
  it("maps features with center [lng, lat] to suggestions", () => {
    const raw = {
      features: [
        { place_name: "Largo, Maryland", center: [-76.83, 38.88] },
        { place_name: "Bowie, Maryland", center: [-76.73, 39.0] },
      ],
    };
    expect(mapMapboxResults(raw)).toEqual([
      { label: "Largo, Maryland", lat: 38.88, lng: -76.83 },
      { label: "Bowie, Maryland", lat: 39.0, lng: -76.73 },
    ]);
  });

  it("drops features missing center or place_name", () => {
    const raw = {
      features: [
        { place_name: "No center" },
        { center: [-76.8, 38.8] },
        { place_name: "Good", center: [-76.8, 38.8] },
      ],
    };
    expect(mapMapboxResults(raw)).toEqual([{ label: "Good", lat: 38.8, lng: -76.8 }]);
  });

  it("returns [] when features missing", () => {
    expect(mapMapboxResults({})).toEqual([]);
    expect(mapMapboxResults(null)).toEqual([]);
  });
});
