# syntax=docker/dockerfile:1
#
# Self-contained image for the BAR Procedural Map Generator.
#  - builds SpringMapConvNG (the SMF compiler) from source
#  - builds the Vite/TypeScript frontend
#  - assembles the official map_blueprint scaffold
#  - installs the spring-map-parser validator
#  - runs the Node server that serves the website AND compiles .sd7 maps
#
# Build:  docker build -t bar-map-generator .
# Run:    docker run --rm -p 8100:8100 bar-map-generator
# Open:   http://localhost:8100

# ---------------------------------------------------------------------------
# 1. Build SpringMapConvNG (C++ / CMake, links DevIL)
#
# The Debian DevIL package ships a broken ILU (missing iluScale et al.), so we
# build DevIL from upstream source first, then compile SpringMapConvNG against
# it. (ILUT needs OpenGL/SDL only to *configure*; we don't use ILUT at runtime.)
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS smfconv
RUN apt-get update && apt-get install -y --no-install-recommends \
      git cmake build-essential ca-certificates \
      libpng-dev libjpeg-dev libtiff-dev liblcms2-dev \
      libsdl2-dev libopengl-dev freeglut3-dev \
    && rm -rf /var/lib/apt/lists/*

# DevIL (IL + ILU) from source → /usr/local
WORKDIR /build
RUN git clone --depth 1 https://github.com/DentonW/DevIL.git
WORKDIR /build/DevIL/DevIL/b
RUN cmake -DBUILD_SHARED_LIBS=ON .. && make -j"$(nproc)" && make install && ldconfig

# SpringMapConvNG against the freshly built DevIL. Two repo quirks handled:
#  - modern CMake drops the bare `ILU` link name, so iluScale/iluFlipImage go
#    unresolved → we force the DevIL libs onto the link by full path.
#  - we build only the springMapConvNG target (the bundled decompiler has an
#    unrelated missing-include compile error we don't need).
WORKDIR /build
RUN git clone --depth 1 https://github.com/tizbac/SpringMapConvNG.git
WORKDIR /build/SpringMapConvNG
RUN printf '\ntarget_link_libraries(springMapConvNG /usr/local/lib/libILU.so /usr/local/lib/libIL.so)\n' >> CMakeLists.txt
WORKDIR /build/SpringMapConvNG/build
RUN cmake -DCMAKE_PREFIX_PATH=/usr/local .. && make -j"$(nproc)" springMapConvNG
# artifacts: ./springMapConvNG  ./libmapconv.so  + /usr/local/lib/libIL*,libILU*

# ---------------------------------------------------------------------------
# 2. Build the frontend (dist/)
# ---------------------------------------------------------------------------
FROM node:18-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# 3. Assemble the official map_blueprint scaffold (generic texture names)
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS scaffold
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /s
RUN git clone --depth 1 https://github.com/beyond-all-reason/map_blueprint.git
COPY docker/build-scaffold.sh /s/build-scaffold.sh
RUN bash /s/build-scaffold.sh /s/map_blueprint /s/scaffold

# ---------------------------------------------------------------------------
# 4. Runtime
# ---------------------------------------------------------------------------
FROM node:18-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      p7zip-full libpng16-16 libjpeg62-turbo libtiff6 liblcms2-2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/bargen

# DevIL runtime libs (the binary statically links mapconv, so no libmapconv.so),
# then refresh the loader cache so /usr/local/lib is searched
COPY --from=smfconv /usr/local/lib/libIL.so*   /usr/local/lib/
COPY --from=smfconv /usr/local/lib/libILU.so*  /usr/local/lib/
COPY --from=smfconv /build/SpringMapConvNG/build/springMapConvNG /opt/bargen/smfconv/springMapConvNG
RUN ldconfig

# frontend + server (server.js uses ES modules → mark the dir as a module)
COPY --from=web /app/dist /opt/bargen/site/dist
COPY server.js            /opt/bargen/site/server.js
RUN echo '{"type":"module","private":true}' > /opt/bargen/site/package.json

# closed-loop validator (spring-map-parser)
COPY validate.mjs                   /opt/bargen/parsertest/validate.mjs
COPY docker/parsertest-package.json /opt/bargen/parsertest/package.json
RUN cd /opt/bargen/parsertest && npm install --omit=dev

# official map scaffold
COPY --from=scaffold /s/scaffold /opt/bargen/scaffold

ENV COMPILER=/opt/bargen/smfconv/springMapConvNG \
    PREFIX=/usr \
    SCAFFOLD=/opt/bargen/scaffold \
    VALIDATOR=/opt/bargen/parsertest/validate.mjs \
    DIST=/opt/bargen/site/dist \
    SEVENZA=7za \
    CT=2 \
    BIND=0.0.0.0 \
    PORT=8100

EXPOSE 8100
WORKDIR /opt/bargen/site
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
