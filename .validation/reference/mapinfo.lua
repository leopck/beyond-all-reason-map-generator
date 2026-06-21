--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
-- mapinfo.lua
--

--TODO:
-- typemap for soft asteroids
-- gadget for destruction of out-of-bounds
-- typemap for non passable out of bounds
-- tuning of metal values
-- enable free fusions via mapoption?
-- tiles no dnts alpha
-- lower the water
-- add transparency to the sides of the paths?
-- less stronk metal view
-- reduce LOAM load by flattening out  voided areas
-- higher water for better camera movement



		
local mapinfo = {
	name        = "Asteroid_Mines_V3",
	shortname   = "Asteroid_Mines_V3",
	description = "4 way map by [teh]Beherith",
	author      = "[teh]Beherith (mysterme@gmail.com)",
	version     = "3",
	--mutator   = "deployment";
	mapfile   = "maps/AM21.smf", --// location of smf/sm3 file (optional)
	modtype     = 3, --// 1=primary, 0=hidden, 3=map
	depend      = {"Map Helper v1"},
	replace     = {},

	--startpic   = "", --// deprecated
	--StartMusic = "", --// deprecated

	maphardness     = 50,
	notDeformable   = false,
	gravity         = 100,
	tidalStrength   = 1,
	maxMetal        = 7.5, --0.69, --=1.40
	extractorRadius = 24.0,
	voidWater       = true,
	autoShowMetal   = true, -- this seems to interfere with cmd area mex


	smf = {
		minheight = -220.0,
		maxheight = 780.0,
		smtFileName0 = "maps/AM21.smt",
	},

	sound = {
		preset = "default",
		passfilter = {
			gainlf = 1.0,
			gainhf = 1.0,
		},
		reverb = {
		},
	},

	resources = {
		--grassBladeTex = "grass_blade_tex.tga", --blade texture
		--grassShadingTex = "grass_shading_tex.tga", --defaults to minimap
		--detailTex = "detailtexblurred.bmp",
		specularTex = "Asteroid_Mines_V2_speculartex.dds",
		splatDetailTex = "iwantDNTS.tga",
		splatDistrTex = "Asteroid_Mines_V2 splatdist_manmade 4096.dds", --sand, rock, pebbles, cracks
		detailNormalTex = "Asteroid_Mines_V2_normals.dds", --holy crap we can do 8K?
		--detailNormalTex = "blanknormal32.png", --holy crap we can do 8K?
		--splatDistrTex = "shading-splat_distr.dds", --sand, rock, pebbles, cracks
		--skyReflectModTex = "skyreflecttex.bmp",
		splatDetailNormalDiffuseAlpha = 1,
		--splatDetailNormalTex1 = "Ground_MossSolid_1k_dnts.tga";
		--the order is cliffs, pebbles, grass, metalspots
		splatDetailNormalTex1 = "Metal_BrushedMetalTilesDirty_1k_dnts.tga"; --hehehe 'pebbles'
		splatDetailNormalTex2 = "Metal_FloorTilesCheckered_2k_dnts_flipped.tga";
		--splatDetailNormalTex2 = "Ground_LargeScaleRockyDirt_1k_dnts.dds";
		--splatDetailNormalTex3 = "test_cube_normal.dds";
		splatDetailNormalTex3 = "Ground_AsteroidTerrain_1k_dnts.tga";
		splatDetailNormalTex4 = "torturedrock.png";
		--lightEmissionTex = "",
	},

	splats = {
		texScales = {0.0078125, 0.00347222222222222222222222222222, 0.0075, 0.01},
		texMults  = {0.75, 0.4, 1.0, 0.4}, --cliff, pebbles, longgrass, sand
	},

	atmosphere = {
		minWind      = 25,
		maxWind      = 25,

		fogStart     = 0.8,
		fogEnd       = 1.0,

		cloudColor = {
		  0.89999998,
		  0.89999998,
		  0.89999998,
		},
    fogColor = {
      0.80000001,
      0.80000001,
      0.5,
    },
    skyColor = {
      0.42879999,
      0.58016002,
      0.63999999,
    },
		sunColor = {
		  1,
		  0.92,
		  0.78,
    },
		skyDir       = {0.0, 0.0, -1.0},
		skyBox       = "Eta_Carinea_Beherith_Overlayed_v6.dds",

		cloudDensity = 0.5,
	},

	grass = {
		bladeWaveScale = 1.0,
		bladeWidth  = 0.82,
		bladeHeight = 8.0,
		bladeAngle  = 2.57,
		bladeColor  = {0.59, 0.81, 0.57}, --// does nothing when `grassBladeTex` is set
	},
	lighting = {
		--// dynsun
		--sunStartAngle = 0.0,
		--sunOrbitTime  = 1440.0, --how do i turn this off?
		    sunDir = {
      0.8,
      1.0,
      -0.7,
    },

		--// unit & ground lighting
         groundambientcolor            = { 0.35, 0.35, 0.35 },
         grounddiffusecolor            = { 0.99, 0.99, 0.95 },
         -- groundambientcolor            = { 0.0, 0.0, 0.0 }, -- specular debugging
         -- grounddiffusecolor            = { 0.0, 0.0, 0.0 }, -- specular debugging
		 groudspecularcolor            = {0.7,0.7,0.7    },
         groundshadowdensity           = 0.75,    
		 unitAmbientColor = {
			  0.56,
			  0.56,
			  0.60,
		},    
		unitDiffuseColor = {
			  0.95,
			  0.95533332,
			  0.90000002,
			},
		unitSpecularColor = {
			  0.8,
			  0.60000001,
			  0.60000001,
		},
         unitshadowdensity          = 0.75,
		 specularsuncolor           = { 1.0, 1.0, 1.0 },
		 
		specularExponent    = 100.0,
	},
		water = { --regular water settings
		damage =  2000,

		repeatX = 10.0,
		repeatY = 10.0,

		absorb    = { 0.08, 0.01, 0.0025 }, --absorbption coefficient per elmo of water depth
		basecolor = { 0.2, 1.2, 0.7 }, -- the color shallow water starts out at
		mincolor  = { 0.0, 0.2, 0.2 },

		ambientFactor  = 1.0,
		diffuseFactor  = 1.0,
		specularFactor = 1.4,
		specularPower  = 40.0,

		surfacecolor  = { 0.67, 0.99, 1.0 }, --color of the water texture
		surfaceAlpha  = 0.1,
		diffuseColor  = {0.0, 0.0, 0.0},
		specularColor = {0.5, 0.5, 0.5},
		--planeColor = {0.00, 0.15, 0.15}, --outside water plane color -- comment this one out if you dont want a water plane!

		fresnelMin   = 0.08, --This defines the minimum amount of light the water surface will reflect when looking vertically down on it [0-1]
		fresnelMax   = 1.6, --Defines the maximum amount of light the water surface will reflect when looking horizontally across it [0-1]
		fresnelPower = 8.0, --Defines how much 

		reflectionDistortion = 0.5,

		blurBase      = 2.0,
		blurExponent = 1.5,

		perlinStartFreq  =  15.0,
		perlinLacunarity = 1.2,
		perlinAmplitude  =  0.8,
		windSpeed = 1.0, --// does nothing yet

		shoreWaves = true,
		forceRendering = false,
		
		hasWaterPlane = false, --specifies whether the outside of the map has an extended water plane

		--// undefined == load them from resources.lua!
		--texture =       "",
		--foamTexture =   "",
		--normalTexture = "",
		--caustics = {
		--	"",
		--	"",
		--},
	},
	
	--[[
	-- lovely acid water settings:
	water = {
		damage =  50,

		repeatX = 0.0,
		repeatY = 0.0,

		absorb    = { 0.01, 0.08, 0.01 },
		basecolor = { 0.8, 0.4, 0.8 }, --or 0.4 0.0 0.4
		mincolor  = { 0.2, 0.0, 0.2 },

		ambientFactor  = 1.0,
		diffuseFactor  = 1.0,
		specularFactor = 1.4,
		specularPower  = 40.0,

		surfacecolor  = { 1.0, 0.65, 1.0 },
		surfaceAlpha  = 0.1,
		diffuseColor  = {0.0, 0.0, 0.0},
		specularColor = {0.5, 0.5, 0.5},
		planeColor = {0.02, 0.035, 0.02},

		fresnelMin   = 0.2,
		fresnelMax   = 1.6,
		fresnelPower = 8.0,

		reflectionDistortion = 1.0,

		blurBase      = 2.0,
		blurExponent = 1.5,

		perlinStartFreq  =  8.0,
		perlinLacunarity = 3.0,
		perlinAmplitude  =  0.9,
		windSpeed = 1.0, --// does nothing yet

		shoreWaves = true,
		forceRendering = false,
		
		hasWaterPlane = true,

		--// undefined == load them from resources.lua!
		--texture =       "",
		--foamTexture =   "",
		--normalTexture = "",
		--caustics = {
		--	"",
		--	"",
		--},
	},]]--

	teams = {
		[0] = {startPos = {x = 1600, z = 1600}},
		[1] = {startPos = {x = 4500, z = 4500}},
		[2] = {startPos = {x = 1600, z = 4500}},
		[3] = {startPos = {x = 4500, z = 1600}},
	},

	terrainTypes = {
		[255] = {
			name = "Asteroid",
			hardness = 1.0,
			receiveTracks = false,
			moveSpeeds = {
				tank  = 1.0,
				kbot  = 1.0,
				hover = 1.0,
				ship  = 1.0,
			},
		},
		[100] = {
			name = "Metal Mines",
			hardness = 10.0,
			receiveTracks = false,
			moveSpeeds = {
				tank  = 1.0,
				kbot  = 1.0,
				hover = 1.0,
				ship  = 1.0,
			},
		},
		[0] = {
			name = "Outer space",
			hardness = 1.0,
			receiveTracks = false,
			moveSpeeds = {
				tank  = 0.0,
				kbot  = 0.0,
				hover = 0.0,
				ship  = 0.0,
			},
		},
	},

	custom = {
		--grassConfig= {
		--	grassDistTGA = "maps/Asteroid_Mines_V1_grassDist.tga",
		--	grassMaxSize = 2.0,
		--	grassBladeColorTex = "maps/violetgrass.tga", -- rgb + alpha transp
		--	grassShaderParams = { -- allcaps because thats how i know
		--		MAPCOLORFACTOR = 0.4, -- how much effect the minimapcolor has
		--		MAPCOLORBASE = 0.6,     --how much more to blend the bottom of the grass patches into map color
		--	},
		--},
		fog = {
			color    = {0.26, 0.30, 0.41},
			height   = "80%", --// allows either absolue sizes or in percent of map's MaxHeight
			fogatten = 0.003,
		},
		
		--[[
		precipitation = {
			density   = 30000,
			size      = 1.5,
			speed     = 50,
			windscale = 1.2,
			texture   = 'LuaGaia/effects/snowflake.png',
		},]]--
	},
}

--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
-- Helper

local function lowerkeys(ta)
	local fix = {}
	for i,v in pairs(ta) do
		if (type(i) == "string") then
			if (i ~= i:lower()) then
				fix[#fix+1] = i
			end
		end
		if (type(v) == "table") then
			lowerkeys(v)
		end
	end
	
	for i=1,#fix do
		local idx = fix[i]
		ta[idx:lower()] = ta[idx]
		ta[idx] = nil
	end
end

lowerkeys(mapinfo)

--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
-- Map Options

if (Spring) then
	local function tmerge(t1, t2)
		for i,v in pairs(t2) do
			if (type(v) == "table") then
				t1[i] = t1[i] or {}
				tmerge(t1[i], v)
			else
				t1[i] = v
			end
		end
	end

	-- make code safe in unitsync
	if (not Spring.GetMapOptions) then
		Spring.GetMapOptions = function() return {} end
	end
	function tobool(val)
		local t = type(val)
		if (t == 'nil') then
			return false
		elseif (t == 'boolean') then
			return val
		elseif (t == 'number') then
			return (val ~= 0)
		elseif (t == 'string') then
			return ((val ~= '0') and (val ~= 'false'))
		end
		return false
	end

	getfenv()["mapinfo"] = mapinfo
		local files = VFS.DirList("mapconfig/mapinfo/", "*.lua")
		table.sort(files)
		for i=1,#files do
			local newcfg = VFS.Include(files[i])
			if newcfg then
				lowerkeys(newcfg)
				tmerge(mapinfo, newcfg)
			end
		end
	getfenv()["mapinfo"] = nil
end

--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

return mapinfo

--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
