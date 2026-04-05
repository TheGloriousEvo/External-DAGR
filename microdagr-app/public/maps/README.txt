Map files are now served by the bridge cache, not by this frontend folder.

Bridge cache location (Windows):
%LOCALAPPDATA%\MicroDAGRBridge\maps

How automatic lookup works:
1) Bridge receives telemetry with worldName.
2) Bridge checks cache for worldKey.(jpg/png/webp/svg).
3) If missing, bridge tries:
	- MICRODAGR_MAP_SOURCE_DIR\<worldKey>.<ext>
	- ./maps\<worldKey>.<ext> (inside arma-bridge working dir)
	- optional extractor command: MICRODAGR_MAP_EXTRACT_CMD
	- default startup already uses: node map-extractor.js
4) If no source is found, bridge creates an SVG placeholder.

Optional extractor command template:
MICRODAGR_MAP_EXTRACT_CMD="myExtractor --world {world} --out {outDir}"

For broad compatibility with modded worlds, configure in bridge environment:
- MICRODAGR_PBO_EXTRACT_CMD (extract .pbo)
- MICRODAGR_PAA_CONVERT_CMD (convert .paa to png/jpg)

The frontend requests map metadata from:
http://<bridge-host>:8080/api/map/<worldKey>
