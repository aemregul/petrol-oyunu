import React from 'react';

/**
 * A field of panels laid flat on a roof: dark glass in a pale frame, in as
 * many rows and columns as the roof takes. Drawn the same on a canopy deck
 * and a shop's flat top, so panels read as one thing wherever they sit.
 */
export const SolarTiles: React.FC<{
  width: number;
  depth: number;
  y: number;
  x?: number;
  z?: number;
}> = ({ width, depth, y, x = 0, z = 0 }) => {
  const tile = 1.15;
  const gap = 0.12;
  const cols = Math.max(1, Math.floor((width + gap) / (tile + gap)));
  const rows = Math.max(1, Math.floor((depth + gap) / (tile + gap)));
  const spanX = cols * tile + (cols - 1) * gap;
  const spanZ = rows * tile + (rows - 1) * gap;
  const cells: Array<[number, number]> = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      cells.push([-spanX / 2 + tile / 2 + c * (tile + gap), -spanZ / 2 + tile / 2 + r * (tile + gap)]);
    }
  }
  return (
    <group position={[x, y, z]}>
      {/* The rail the panels sit on */}
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[spanX + 0.2, 0.08, spanZ + 0.2]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.7} metalness={0.3} />
      </mesh>
      {cells.map(([cx, cz], i) => (
        <group key={i} position={[cx, 0.12, cz]}>
          <mesh>
            <boxGeometry args={[tile, 0.08, tile]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.5} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0.045, 0]}>
            <boxGeometry args={[tile - 0.14, 0.02, tile - 0.14]} />
            <meshStandardMaterial color="#1e3a8a" roughness={0.2} metalness={0.6} emissive="#1d4ed8" emissiveIntensity={0.12} />
          </mesh>
        </group>
      ))}
    </group>
  );
};
