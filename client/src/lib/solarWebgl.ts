export const SOLAR_TEXTURE_URL = "/assets/solar/nasa-hmi-solar-disc-2011.webp";
export const SOLAR_TEXTURE_MAX_EDGE = 1024;

const LONGITUDE_SEGMENTS = 64;
const LATITUDE_SEGMENTS = 32;
const MAX_CANVAS_PIXELS = 192;
const MAX_DEVICE_PIXEL_RATIO = 2;
const SPHERE_SCREEN_SCALE = 0.92;

type Vec3 = readonly [number, number, number];

/** Orthographic projection: the photographed HMI disk stays on its observed face. */
export function getSolarOrthographicUv(normal: Vec3): readonly [number, number] {
  return [normal[0] * 0.5 + 0.5, normal[1] * 0.5 + 0.5];
}

/** The back hemisphere has no HMI observation and is intentionally not textured. */
export function isSolarObservedFace(normal: Vec3): boolean {
  return normal[2] > 0;
}

/** Vertices for a closed, unit-radius sphere; the camera never rotates this mesh. */
export function createSolarSphereVertices(): Float32Array {
  const vertices: number[] = [];
  const point = (latitudeIndex: number, longitudeIndex: number): Vec3 => {
    const latitude = -Math.PI / 2 + Math.PI * latitudeIndex / LATITUDE_SEGMENTS;
    const longitude = -Math.PI + 2 * Math.PI * longitudeIndex / LONGITUDE_SEGMENTS;
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
varying vec2 vSolarUv;
void main() {
  vNormal = normalize(aPosition);
  vSolarUv = aPosition.xy * 0.5 + 0.5;
  gl_Position = vec4(aPosition * ${SPHERE_SCREEN_SCALE.toFixed(2)}, 1.0);
  gl_Position.z = -aPosition.z * ${SPHERE_SCREEN_SCALE.toFixed(2)};
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying vec2 vSolarUv;
uniform sampler2D uSolarImage;
void main() {
  if (vNormal.z <= 0.0) discard;
  vec4 observedFace = texture2D(uSolarImage, vSolarUv);
  if (observedFace.a <= 0.003) discard;
  // The HMI image is emissive: do not apply a lunar terminator or alter its brightness.
  gl_FragColor = observedFace;
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL ne peut pas créer un shader solaire.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Compilation du shader solaire impossible.";
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

export type SolarWebGLRenderer = {
  render: () => void;
  dispose: () => void;
};

export function createSolarWebGLRenderer(canvas: HTMLCanvasElement, image: HTMLImageElement): SolarWebGLRenderer | null {
  if (!image.complete || image.naturalWidth < 1 || image.naturalHeight < 1) return null;
  if (image.naturalWidth > SOLAR_TEXTURE_MAX_EDGE || image.naturalHeight > SOLAR_TEXTURE_MAX_EDGE) return null;

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
    if (!program) throw new Error("WebGL ne peut pas créer le programme solaire.");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Liaison du programme solaire impossible.");
    }

    const positionLocation = gl.getAttribLocation(program, "aPosition");
    const solarImageLocation = gl.getUniformLocation(program, "uSolarImage");
    if (positionLocation < 0 || solarImageLocation === null) {
      throw new Error("Attribut ou uniforme solaire absent du programme WebGL.");
    }

    buffer = gl.createBuffer();
    texture = gl.createTexture();
    if (!buffer || !texture) throw new Error("WebGL ne peut pas réserver les ressources solaires.");

    const vertices = createSolarSphereVertices();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.useProgram(program);
    gl.uniform1i(solarImageLocation, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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

    const render = () => {
      if (gl.isContextLost()) return;
      resize();
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 3);
    };

    render();
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
