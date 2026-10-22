import { getSnowCanvasPixelSize } from "./snowVisualEngine";

const VERTEX_SHADER = `
attribute vec2 aPosition;
attribute float aOpacity;
attribute float aSize;
attribute float aRotation;
uniform float uPixelRatio;
varying float vOpacity;
varying float vRotation;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  gl_PointSize = clamp(aSize * uPixelRatio, 1.0, 12.0);
  vOpacity = aOpacity;
  vRotation = aRotation;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying float vOpacity;
varying float vRotation;
void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  float radius = length(point);
  float angle = atan(point.y, point.x) + vRotation;
  float core = 1.0 - smoothstep(0.04, 0.42, radius);
  float arms = pow(max(cos(angle * 6.0), 0.0), 9.0);
  float edge = 1.0 - smoothstep(0.72, 1.0, radius);
  float flake = max(core * 0.58, arms * smoothstep(0.16, 0.38, radius) * 0.92);
  float alpha = flake * edge * vOpacity;
  if (alpha < 0.018) discard;
  gl_FragColor = vec4(0.86, 0.94, 1.0, alpha * 0.86);
}
`;

export type SnowWebGLRenderer = {
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

export function createSnowWebGLRenderer(
  canvas: HTMLCanvasElement
): SnowWebGLRenderer | null {
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
  let rotationLocation = -1;
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
    if (!vertexShader || !fragmentShader)
      throw new Error("Compilation du shader neige impossible.");

    program = gl.createProgram();
    buffer = gl.createBuffer();
    if (!program || !buffer)
      throw new Error("Ressources WebGL neige indisponibles.");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Liaison du shader neige impossible.");
    }

    positionLocation = gl.getAttribLocation(program, "aPosition");
    opacityLocation = gl.getAttribLocation(program, "aOpacity");
    sizeLocation = gl.getAttribLocation(program, "aSize");
    rotationLocation = gl.getAttribLocation(program, "aRotation");
    pixelRatioLocation = gl.getUniformLocation(program, "uPixelRatio");
    if (
      positionLocation < 0 ||
      opacityLocation < 0 ||
      sizeLocation < 0 ||
      rotationLocation < 0 ||
      !pixelRatioLocation
    ) {
      throw new Error("Attribut WebGL neige absent.");
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = 5 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(opacityLocation);
    gl.vertexAttribPointer(
      opacityLocation,
      1,
      gl.FLOAT,
      false,
      stride,
      2 * Float32Array.BYTES_PER_ELEMENT
    );
    gl.enableVertexAttribArray(sizeLocation);
    gl.vertexAttribPointer(
      sizeLocation,
      1,
      gl.FLOAT,
      false,
      stride,
      3 * Float32Array.BYTES_PER_ELEMENT
    );
    gl.enableVertexAttribArray(rotationLocation);
    gl.vertexAttribPointer(
      rotationLocation,
      1,
      gl.FLOAT,
      false,
      stride,
      4 * Float32Array.BYTES_PER_ELEMENT
    );
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);

    return {
      resize: (cssWidth, cssHeight, devicePixelRatio) => {
        if (gl!.isContextLost()) return;
        const pixelSize = getSnowCanvasPixelSize(
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
        gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, vertices);
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
