import React from 'react';
import { DECAL, decal } from './decal';

/**
 * Emre'nin 2026-09-02 isteği (ilham: beneloil): her servis noktasının önünde
 * boyalı bir DURUŞ ALANI — pompanın/şarjın hangi yüzünün "ön" olduğunu hem
 * sürücüye hem oyuncuya söyleyen yeşil çerçeve. Oyuncu tesisiyi bu boyaya
 * bakarak kurar.
 *
 * Konum süsten türetilmez: worldOffset, motorun aracı GERÇEKTEN durdurduğu
 * bay noktasıdır (pumpBayOffset / şarj bay'i) — görsel ile davranış aynı
 * kaynaktan akar, ayrışamaz. Pad, döndürülmüş mesh grubunun içinde
 * çizildiğinden dünya-ofseti buraya gelmeden önce local eksene çevrilir.
 */
export const BayPad: React.FC<{
  /** Bay merkezi, yapının merkezinden DÜNYA ekseninde (world birimi). */
  worldOffset: [number, number];
  /** Aracın durduğu doğrultu, dünya ekseninde. */
  worldAlong: 'x' | 'z';
  /** Yapının Y dönüşü (derece) — grup zaten dönük, ofset geri çevrilir. */
  rotationDeg: number;
  color?: string;
}> = ({ worldOffset, worldAlong, rotationDeg, color = '#22c55e' }) => {
  const theta = (rotationDeg * Math.PI) / 180;
  const [wx, wz] = worldOffset;
  const x = wx * Math.cos(theta) - wz * Math.sin(theta);
  const z = wx * Math.sin(theta) + wz * Math.cos(theta);

  const turned = rotationDeg % 180 !== 0;
  const alongLocalX = (worldAlong === 'x') !== turned;

  // Bir araç gövdesi kadar: 3.6 dünya birimi boy, 1.7 en — payıyla.
  const w = alongLocalX ? 4.0 : 2.4;
  const d = alongLocalX ? 2.4 : 4.0;
  const line = 0.14;

  return (
    <group position={[x, 0, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={color} transparent opacity={0.14} {...DECAL} />
      </mesh>
      {/* Çerçeve: dört kenar çizgisi */}
      {[
        [0, -d / 2 + line / 2, w, line],
        [0, d / 2 - line / 2, w, line],
        [-w / 2 + line / 2, 0, line, d - line * 2],
        [w / 2 - line / 2, 0, line, d - line * 2]
      ].map(([px, pz, sw, sd], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[px, 0.02, pz]}>
          <planeGeometry args={[sw, sd]} />
          <meshBasicMaterial color={color} transparent opacity={0.85} {...decal(2)} />
        </mesh>
      ))}
    </group>
  );
};
