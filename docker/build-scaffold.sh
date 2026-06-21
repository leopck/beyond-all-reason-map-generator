#!/usr/bin/env bash
# Assemble the runtime map scaffold from a cloned beyond-all-reason/map_blueprint.
# The scaffold is the official, working BAR map skeleton (LuaGaia FeaturePlacer,
# tree FeatureDef + model + textures, maphelper, mapconfig, splat material DDS).
# Every generated map is compiled on top of it; we only swap in our terrain,
# mapinfo, feature positions and splat distribution.
#
# Usage: build-scaffold.sh <map_blueprint_dir> <out_scaffold_dir>
set -euo pipefail
BP="${1:?map_blueprint dir}"
S="${2:?output scaffold dir}"

rm -rf "$S"
mkdir -p "$S"/maps "$S"/LuaGaia/Gadgets "$S"/LuaGaia/effects "$S"/features \
         "$S"/objects3d "$S"/unittextures "$S"/maphelper "$S"/mapconfig/mapinfo \
         "$S"/mapconfig/featureplacer

# boilerplate lua + gadgets (verbatim)
cp "$BP/LuaGaia/main.lua" "$BP/LuaGaia/draw.lua" "$S"/LuaGaia/
cp "$BP/LuaGaia/Gadgets/FP_featureplacer.lua" "$S"/LuaGaia/Gadgets/
cp "$BP"/LuaGaia/effects/* "$S"/LuaGaia/effects/ 2>/dev/null || true
cp "$BP/features/ad0newfeatures.lua" "$S"/features/
cp "$BP"/objects3d/*.s3o "$S"/objects3d/
cp "$BP"/unittextures/*.dds "$S"/unittextures/
cp "$BP/maphelper/mapinfo.lua" "$S"/maphelper/
cp "$BP/mapconfig/mapinfo/0_apply_options.lua" "$S"/mapconfig/mapinfo/
cp "$BP/mapconfig/featureplacer/config.lua" "$S"/mapconfig/featureplacer/
cp "$BP/mapoptions.lua" "$S"/

# splat material textures → generic names (strip the map-name prefix)
cp "$BP/maps/MAP_BLUEPRINT_V1_Rock_Brown_1k_dnts.dds"                 "$S/maps/Rock_Brown_1k_dnts.dds"
cp "$BP/maps/Map_Blueprint_V1_Ground_GrassThickGreen_1k_dnts.dds"     "$S/maps/Ground_GrassThickGreen_1k_dnts.dds"
cp "$BP/maps/Map_Blueprint_V1_Ground_LargeScaleRockyDirt_1k_dnts.dds" "$S/maps/Ground_LargeScaleRockyDirt_1k_dnts.dds"
cp "$BP/maps/Map_Blueprint_V1_earth_NORM.dds"                         "$S/maps/earth_NORM.dds"
cp "$BP/maps/detailtexblurred.bmp"           "$S/maps/"
cp "$BP/maps/grass_field_dry.dds.cached.dds" "$S/maps/"
cp "$BP/maps/waterbump_4tiles.png"           "$S/maps/"

echo "scaffold assembled at $S:"
find "$S" -type f | sort
