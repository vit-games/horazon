import { useState } from 'react';
import { itemImage, itemSize } from '../lib/itemImage';
import type { Item } from '../lib/types';

const CELL = 28; // px per inventory cell = the art's native size (never upscale by a non-integer)

/**
 * Inventory art for an item. With `box`, the image is scaled down to fit a
 * fixed square (for list rows); otherwise it's drawn at inventory size. `grow` also scales small
 * art up by a whole step (2×, crisp pixels) toward the box, so a 1×1 sigil reads as large as a 2×2 shield, for the showcase cards.
 */
export function ItemIcon({ item, box, scale = 1, grow = false, maxStep = 2 }: { item: Item; box?: number; scale?: number; grow?: boolean; maxStep?: number }) {
  const image = itemImage(item);
  // Failed loads of this image: the item's art, again (a download can fail once), its base's
  // (the site has no art for a few uniques), then none.
  const [failure, setFailure] = useState({ of: '', count: 0 });
  const failed = failure.of === image?.src ? failure.count : 0;
  const src = [image?.src, image && `${image.src}?retry`, image?.fallback][failed];
  const { w, h } = itemSize(item);
  const step = grow && box ? Math.max(1, Math.min(maxStep, Math.floor(Math.min(box / (w * CELL), box / (h * CELL))))) : scale;
  const width = w * CELL * step;
  const height = h * CELL * step;
  const fit = box ? Math.min(1, box / width, box / height) : 1;

  const classes = [image?.tint, item.is_ethereal && 'ethereal'].filter(Boolean).join(' ');

  return (
    <div
      className="flex shrink-0 items-center justify-center"
      style={box ? { width: box, height: box } : { width, height }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className={classes}
          style={{ width: width * fit, height: height * fit, imageRendering: step > 1 ? 'pixelated' : undefined }}
          loading="lazy"
          onError={() => setFailure({ of: image!.src, count: failed + 1 })}
        />
      ) : (
        <div
          className="rounded-sm border border-dashed border-line"
          style={{ width: Math.min(width, box ?? width), height: Math.min(height, box ?? height) }}
        />
      )}
    </div>
  );
}
