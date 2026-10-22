import { getHailCanvasPixelSize } from "./hailVisualEngine";

const VERTEX_SHADER = `
attribute vec2 aPosition;
attribute float aOpacity;
attribute float aSize;
attribute float aDepth;
uniform float uPixelRatio;
varying float vOpacity;
varying float vDepth;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  gl_PointSize = clamp(aSize * uPixelRatio, 1.0, 14.0);
  vOpacity = aOpacity;
  vDepth = aDepth;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying float vOpacity;
varying float vDepth;
void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  float radiusSquared = dot(point, point);
  if (radiusSquared > 1.0) discard;
  float depth = sqrt(max(0.0, 1.0 - radiusSquared));
  vec3 normal = normalize(vec3(point.x, -point.y, depth));
  vec3 lightDirection = normalize(vec3(-0.48, 0.58, 0.66));
  float diffuse = max(dot(normal, lightDirection), 0.0);
  float specular = pow(max(dot(reflect(-lightDirection, normal), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
  float edge = 1.0 - smoothstep(0.72, 1.0, sqrt(radiusSquared));
  vec3 shadowColor = vec3(0.22, 0.48, 0.66);
  vec3 litColor = vec3(0.87, 0.96, 1.0);
  vec3 sphereColor = mix(shadowColor, litColor, 0.24 + diffuse * 0.62 + vDepth * 0.08);
  sphereColor += vec3(0.34, 0.42, 0.48) * specular;
  float alpha = edge * vOpacity * (0.74 + vDepth * 0.18);
  if (alpha < 0.018) discard;
  gl_FragColor = vec4(sphereColor, alpha);
}
`;

export type HailWebGLRenderer = {
  resize: (
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio: number
  ) => void;
  draw: (vertices: Float32Array) => void;
  dispose: () => void;
};

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createHailWebGLRenderer(
  canvas: HTMLCanvasElement
): HailWebGLRenderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
  } catch {
    return null;
  }
  if (!gl) return null;

  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let positionLocation = -1;
  let opacityLocation = -1;
  let sizeLocation = -1;
  let depthLocation = -1;
  let pixelRatioLocation: WebGLUniformLocation | null = null;
  let allocatedBytes = 0;
  let pixelRatio = 1;

  const cleanup = () => {
    if (buffer) gl?.deleteBuffer(buffer);
    if (program) gl?.deleteProgram(program);
    if (vertexShader) gl?.deleteShader(vertexShader);
    if (fragmentShader) gl?.deleteShader(fragmentShader);
    buffer = null;
    program = null;
    vertexShader = null;
    fragmentShader = null;
  };

  try {
    vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) {
      throw new Error("Compilation du shader grêle impossible.");
    }

    program = gl.createProgram();
    buffer = gl.createBuffer();
    if (!program || !buffer) throw new Error("Ressources WebGL indisponibles.");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Liaison du shader grêle impossible.");
    }

    positionLocation = gl.getAttribLocation(program, "aPosition");
    opacityLocation = gl.getAttribLocation(program, "aOpacity");
    sizeLocation = gl.getAttribLocation(program, "aSize");
    depthLocation = gl.getAttribLocation(program, "aDepth");
    pixelRatioLocation = gl.getUniformLocation(program, "uPixelRatio");
    if (
      positionLocation < 0 ||
      opacityLocation < 0 ||
      sizeLocation < 0 ||
      depthLocation < 0 ||
      pixelRatioLocation === null
    ) {
      throw new Error("Attribut WebGL grêle absent.");
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = 5 * Float32Array.BYTES_PER_ELEMENT;
    const bindAttribute = (location: number, size: number, offset: number) => {
      gl!.enableVertexAttribArray(location);
      gl!.vertexAttribPointer(
        location,
        size,
        gl!.FLOAT,
        false,
        stride,
        offset * Float32Array.BYTES_PER_ELEMENT
      );
    };
    bindAttribute(positionLocation, 2, 0);
    bindAttribute(opacityLocation, 1, 2);
    bindAttribute(sizeLocation, 1, 3);
    bindAttribute(depthLocation, 1, 4);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);

    return {
      resize: (cssWidth, cssHeight, devicePixelRatio) => {
        if (gl!.isContextLost()) return;
        const pixelSize = getHailCanvasPixelSize(
          cssWidth,
          cssHeight,
          devicePixelRatio
        );
        if (
          canvas.width !== pixelSize.width ||
          canvas.height !== pixelSize.height
        ) {
          canvas.width = pixelSize.width;
          canvas.height = pixelSize.height;
        }
        pixelRatio = canvas.width / Math.max(1, cssWidth);
        gl!.viewport(0, 0, pixelSize.width, pixelSize.height);
      },
      draw: vertices => {
        if (gl!.isContextLost()) return;
        gl!.useProgram(program);
        gl!.uniform1f(pixelRatioLocation, pixelRatio);
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
        if (vertices.byteLength > allocatedBytes) {
          allocatedBytes = vertices.byteLength;
          gl!.bufferData(gl!.ARRAY_BUFFER, allocatedBytes, gl!.DYNAMIC_DRAW);
        }
        if (vertices.byteLength > 0) {
          gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, vertices);
        }
        gl!.clear(gl!.COLOR_BUFFER_BIT);
        gl!.drawArrays(gl!.POINTS, 0, vertices.length / 5);
      },
      dispose: cleanup,
    };
  } catch {
    cleanup();
    return null;
  }
}
