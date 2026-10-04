# Local geography asset

`world-map.json` contains land outlines and country-level cartographic label
centers from Natural Earth. These centers are approximate country markers, not
measured visitor coordinates or city locations. No borders are shown.

Source data is public domain, as confirmed on
<https://www.naturalearthdata.com/about/terms-of-use/> and the primary maintainer
repository <https://github.com/nvkelso/natural-earth-vector>.

The source URLs, retrieval date and input SHA-256 hashes are embedded in the
JSON asset. Outlines use the small 110m land dataset, rounded to 0.001 degrees;
centers use 50m countries to include smaller territories, rounded to 0.01 degrees.
The source GeoJSON is only used during preparation. It is not fetched at runtime.

To reproduce, download the two source files listed in the asset and run:

```sh
node frontend/dashboard/prepare-map.mjs /tmp/land.geojson /tmp/countries.geojson
```

The canvas marks only countries present in the real aggregate API data. Unknown
or unsupported country codes remain in the accessible list and are not plotted.
Pulse halos illustrate aggregate country values, not arrivals or live movement.
