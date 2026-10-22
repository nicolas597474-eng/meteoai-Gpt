export const LUNAR_TEXTURE_URL = "/assets/lunar/nasa-lroc-wac-moon-2k.webp";
export const LUNAR_TEXTURE_MAX_EDGE = 2048;

const LONGITUDE_SEGMENTS = 48;
const LATITUDE_SEGMENTS = 24;
const MAX_CANVAS_PIXELS = 192;
const MAX_DEVICE_PIXEL_RATIO = 2;
const DEG_TO_RAD = Math.PI / 180;
const TAU = Math.PI * 2;

export type Vec3 = readonly [number, number, number];

export type LunarPhaseVisual = {
  angleDeg: number;
  label: string;
  symbol: string;
  waxing: boolean;
  illuminationPct: number;
  brightLimbAngleDeg: number;
  illuminationFraction?: number;
  librationLongitudeDeg?: number;
  librationLatitudeDeg?: number;
  lunarNorthPoleAngleDeg?: number;
};

export type LunarTextureBasis = {
  earthFacingBody: Vec3;
  eastBody: Vec3;
  northBody: Vec3;
  eastCamera: Vec3;
  northCamera: Vec3;
};

export function getLunarSunDirection(illuminationFraction: number, brightLimbAngleDeg: number): Vec3 {
  const fraction = Number.isFinite(illuminationFraction) ? Math.max(0, Math.min(1, illuminationFraction)) : 0;
  const cosinePhaseAngle = 2 * fraction - 1;
  const projectedMagnitude = Math.sqrt(Math.max(0, 1 - cosinePhaseAngle * cosinePhaseAngle));
  const positionAngle = (Number.isFinite(brightLimbAngleDeg) ? brightLimbAngleDeg : 0) * DEG_TO_RAD;
  return [
    -Math.sin(positionAngle) * projectedMagnitude,
    Math.cos(positionAngle) * projectedMagnitude,
    cosinePhaseAngle,
  ];
}

/** Build the rotation basis from the Earth-facing libration point and the local lunar north-pole position angle. */
export function getLunarTextureBasis(
  librationLongitudeDeg = 0,
  librationLatitudeDeg = 0,
  lunarNorthPoleAngleDeg = 0,
): LunarTextureBasis {
  const longitude = (Number.isFinite(librationLongitudeDeg) ? librationLongitudeDeg : 0) * DEG_TO_RAD;
  const latitude = Math.max(-90, Math.min(90, Number.isFinite(librationLatitudeDeg) ? librationLatitudeDeg : 0)) * DEG_TO_RAD;
  const poleAngle = (Number.isFinite(lunarNorthPoleAngleDeg) ? lunarNorthPoleAngleDeg : 0) * DEG_TO_RAD;
  const cosLongitude = Math.cos(longitude);
  const sinLongitude = Math.sin(longitude);
  const cosLatitude = Math.cos(latitude);
  const sinLatitude = Math.sin(latitude);
  const cosPole = Math.cos(poleAngle);
  const sinPole = Math.sin(poleAngle);

  return {
    earthFacingBody: [cosLatitude * cosLongitude, cosLatitude * sinLongitude, sinLatitude],
    eastBody: [-sinLongitude, cosLongitude, 0],
    northBody: [-sinLatitude * cosLongitude, -sinLatitude * sinLongitude, cosLatitude],
    eastCamera: [cosPole, sinPole, 0],
    northCamera: [-sinPole, cosPole, 0],
  };
}

export function projectCameraNormalToLunarBody(viewNormal: Vec3, basis: LunarTextureBasis): Vec3 {
  const eastAmount = dot(viewNormal, basis.eastCamera);
  const northAmount = dot(viewNormal, basis.northCamera);
  return normalize([
    viewNormal[2] * basis.earthFacingBody[0] + eastAmount * basis.eastBody[0] + northAmount * basis.northBody[0],
    viewNormal[2] * basis.earthFacingBody[1] + eastAmount * basis.eastBody[1] + northAmount * basis.northBody[1],
    viewNormal[2] * basis.earthFacingBody[2] + eastAmount * basis.eastBody[2] + northAmount * basis.northBody[2],
  ]);
}

export function getLunarEquirectangularCoordinates(bodyNormal: Vec3): readonly [number, number] {
  const longitude = Math.atan2(bodyNormal[1], bodyNormal[0]);
  const latitude = Math.asin(Math.max(-1, Math.min(1, bodyNormal[2])));
  return [((longitude / TAU + 0.5) % 1 + 1) % 1, 0.5 + latitude / Math.PI];
}

export function createLunarSphereVertices(): Float32Array {
  const vertices: number[] = [];
  const point = (latitudeIndex: number, longitudeIndex: number): Vec3 => {
    const latitude = -Math.PI / 2 + Math.PI * latitudeIndex / LATITUDE_SEGMENTS;
    const longitude = -Math.PI + TAU * longitudeIndex / LONGITUDE_SEGMENTS;
    const cosLatitude = Math.cos(latitude);
    return [cosLatitude * Math.sin(longitude), Math.sin(latitude), cosLatitude * Math.cos(longitude)];
  };
  const append = (vertex: Vec3) => vertices.push(vertex[0], vertex[1], vertex[2]);

  for (let latitudeIndex = 0; latitudeIndex < LATITUDE_SEGMENTS; latitudeIndex += 1) {
    for (let longitudeIndex = 0; longitudeIndex < LONGITUDE_SEGMENTS; longitudeIndex += 1) {
      const southWest = point(latitudeIndex, longitudeIndex);
      const southEast = point(latitudeIndex, longitudeIndex + 1);
      const northWest = point(latitudeIndex + 1, longitudeIndex);
      const northEast = point(latitudeIndex + 1, longitudeIndex + 1);
      append(southWest);
      append(southEast);
      append(northWest);
      append(southEast);
      append(northEast);
      append(northWest);
    }
  }

  return new Float32Array(vertices);
}

const VERTEX_SHADER = `
attribute vec3 aPosition;
varying vec3 vNormal;
void main() {
  vNormal = normalize(aPosition);
  gl_Position = vec4(aPosition.xy * 0.985, -aPosition.z * 0.5, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;
varying vec3 vNormal;
uniform sampler2D uMoonTexture;
uniform vec3 uSunDirection;
uniform vec3 uEarthFacingBody;
uniform vec3 uEastBody;
uniform vec3 uNorthBody;
uniform vec3 uEastCamera;
uniform vec3 uNorthCamera;
const float PI = 3.1415926535897932384626433832795;
const float TAU = 6.283185307179586476925286766559;
vec3 srgbToLinear(vec3 color) {
  vec3 low = color / 12.92;
  vec3 high = pow((color + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, step(color, vec3(0.04045)));
}
vec3 linearToSrgb(vec3 color) {
  color = max(color, vec3(0.0));
  vec3 low = color * 12.92;
  vec3 high = 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, step(color, vec3(0.0031308)));
}
void main() {
  vec3 viewNormal = normalize(vNormal);
  vec3 bodyNormal = normalize(
    viewNormal.z * uEarthFacingBody
    + dot(viewNormal, uEastCamera) * uEastBody
    + dot(viewNormal, uNorthCamera) * uNorthBody
  );
  float longitude = atan(bodyNormal.y, bodyNormal.x);
  float latitude = asin(clamp(bodyNormal.z, -1.0, 1.0));
  vec2 uv = vec2(fract(longitude / TAU + 0.5), clamp(0.5 + latitude / PI, 0.0, 1.0));
  vec3 albedo = srgbToLinear(texture2D(uMoonTexture, uv).rgb);
  float cosineLight = dot(viewNormal, normalize(uSunDirection));
  float terminatorCoverage = smoothstep(-0.008, 0.008, cosineLight);
  float diffuse = max(cosineLight, 0.0) * terminatorCoverage;
  vec3 shaded = albedo * (0.022 + 0.978 * diffuse);
  gl_FragColor = vec4(linearToSrgb(shaded), 1.0);
}
`;

function dot(left: Vec3, right: Vec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL ne peut pas créer un shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Compilation du shader lunaire impossible.";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function releaseFailedWebGLContext(gl: WebGLRenderingContext) {
  try {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Le contexte a peut-être déjà été perdu par le navigateur.
  }
}

export type LunarWebGLRenderer = {
  render: (phase: LunarPhaseVisual) => void;
  dispose: () => void;
};

export function createLunarWebGLRenderer(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  initialPhase: LunarPhaseVisual,
): LunarWebGLRenderer | null {
  if (image.naturalWidth > LUNAR_TEXTURE_MAX_EDGE || image.naturalHeight > LUNAR_TEXTURE_MAX_EDGE) return null;
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    depth: true,
    powerPreference: "low-power",
    premultipliedAlpha: false,
  });
  if (!gl) return null;

  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  try {
    const maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (image.naturalWidth > maximumTextureSize || image.naturalHeight > maximumTextureSize) {
      releaseFailedWebGLContext(gl);
      return null;
    }

    vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    program = gl.createProgram();
    if (!program) throw new Error("WebGL ne peut pas créer le programme lunaire.");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Liaison du programme lunaire impossible.");
    }

    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const locations = {
      moonTexture: gl.getUniformLocation(program, "uMoonTexture"),
      sunDirection: gl.getUniformLocation(program, "uSunDirection"),
      earthFacingBody: gl.getUniformLocation(program, "uEarthFacingBody"),
      eastBody: gl.getUniformLocation(program, "uEastBody"),
      northBody: gl.getUniformLocation(program, "uNorthBody"),
      eastCamera: gl.getUniformLocation(program, "uEastCamera"),
      northCamera: gl.getUniformLocation(program, "uNorthCamera"),
    };
    if (positionLocation < 0 || Object.values(locations).some((location) => location === null)) {
      throw new Error("Attribut ou uniforme lunaire absent du programme WebGL.");
    }

    buffer = gl.createBuffer();
    texture = gl.createTexture();
    if (!buffer || !texture) throw new Error("WebGL ne peut pas réserver les ressources lunaires.");

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const vertices = createLunarSphereVertices();
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.useProgram(program);
    gl.uniform1i(locations.moonTexture, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
      const side = Math.max(1, Math.min(MAX_CANVAS_PIXELS, Math.round(Math.max(bounds.width, bounds.height, 1) * ratio)));
      if (canvas.width !== side || canvas.height !== side) {
        canvas.width = side;
        canvas.height = side;
      }
      gl.viewport(0, 0, side, side);
    };

    const render = (phase: LunarPhaseVisual) => {
      if (gl.isContextLost()) return;
      resize();
      const fraction = phase.illuminationFraction ?? phase.illuminationPct / 100;
      const sunDirection = getLunarSunDirection(fraction, phase.brightLimbAngleDeg);
      const basis = getLunarTextureBasis(
        phase.librationLongitudeDeg,
        phase.librationLatitudeDeg,
        phase.lunarNorthPoleAngleDeg,
      );
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform3fv(locations.sunDirection, new Float32Array(sunDirection));
      gl.uniform3fv(locations.earthFacingBody, new Float32Array(basis.earthFacingBody));
      gl.uniform3fv(locations.eastBody, new Float32Array(basis.eastBody));
      gl.uniform3fv(locations.northBody, new Float32Array(basis.northBody));
      gl.uniform3fv(locations.eastCamera, new Float32Array(basis.eastCamera));
      gl.uniform3fv(locations.northCamera, new Float32Array(basis.northCamera));
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 3);
    };

    render(initialPhase);
    return {
      render,
      dispose: () => {
        try {
          if (buffer) gl.deleteBuffer(buffer);
          if (texture) gl.deleteTexture(texture);
          if (program) gl.deleteProgram(program);
          if (vertexShader) gl.deleteShader(vertexShader);
          if (fragmentShader) gl.deleteShader(fragmentShader);
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        } catch {
          // Le contexte peut déjà avoir été perdu par le navigateur ou le système.
        }
      },
    };
  } catch {
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    if (program) gl.deleteProgram(program);
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    releaseFailedWebGLContext(gl);
    return null;
  }
}
