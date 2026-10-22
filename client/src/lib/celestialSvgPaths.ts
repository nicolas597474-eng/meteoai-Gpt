export type ApparentBodyPositionLike = {
  altitudeDeg: number | null;
  azimuthDeg: number | null;
  aboveHorizon: boolean;
};

export type ApparentTrajectoryPathPoint = ApparentBodyPositionLike & {
  at: string;
};

export type TerrainHorizonPathPoint = {
  azimuthDeg: number;
  elevationDeg: number;
};

/** Projection horizontale : Est à gauche, Sud au sommet, Ouest à droite. */
export function projectApparentBodyOnArc(position: ApparentBodyPositionLike) {
  const { altitudeDeg, azimuthDeg } = position;
  if (
    !position.aboveHorizon ||
    altitudeDeg == null ||
    azimuthDeg == null ||
    !Number.isFinite(altitudeDeg) ||
    !Number.isFinite(azimuthDeg)
  ) {
    return null;
  }

  const altitudeRadians = (altitudeDeg * Math.PI) / 180;
  const azimuthRadians = (azimuthDeg * Math.PI) / 180;
  return {
    left: 50 - 42 * Math.sin(azimuthRadians),
    bottom: 16 + Math.max(0, Math.sin(altitudeRadians)) * 124,
  };
}

export function buildTrajectoryPath(
  points: readonly ApparentTrajectoryPathPoint[]
) {
  let hasVisiblePoint = false;
  return points
    .reduce((path, point) => {
      const projected = projectApparentBodyOnArc(point);
      if (!projected) {
        hasVisiblePoint = false;
        return path;
      }

      const command = hasVisiblePoint ? "L" : "M";
      hasVisiblePoint = true;
      return `${path}${command}${projected.left.toFixed(2)} ${(160 - projected.bottom).toFixed(2)} `;
    }, "")
    .trim();
}

export function buildTerrainPath(points: readonly TerrainHorizonPathPoint[],groundBottom=158) {
  const validPoints = points.filter(
    point =>
      Number.isFinite(point.azimuthDeg) && Number.isFinite(point.elevationDeg) &&
      point.azimuthDeg >= 90 && point.azimuthDeg <= 270
  );
  if (validPoints.length === 0) return "";

  const sorted = [...validPoints].sort(
    (left, right) => left.azimuthDeg - right.azimuthDeg
  );
  const project = (point: TerrainHorizonPathPoint) => {
    const azimuthRadians = (point.azimuthDeg * Math.PI) / 180;
    const left = 50 - 42 * Math.sin(azimuthRadians);
    const altitudeRadians = (point.elevationDeg * Math.PI) / 180;
    const bottom = Math.max(2,16 + Math.sin(altitudeRadians) * 124);
    return { x: left, y: 160 - bottom };
  };

  const first = project(sorted[0]);
  let path = `M${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (let index = 1; index < sorted.length; index += 1) {
    const point = project(sorted[index]);
    path += ` L${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }
  return `${path} L100 ${groundBottom} L0 ${groundBottom} Z`;
}
