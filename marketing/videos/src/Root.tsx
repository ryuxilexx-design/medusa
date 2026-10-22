import React from 'react';
import { Composition, Folder } from 'remotion';
import { PROMOS } from './data';
import { PromoVideo } from './Promo';

const FPS = 30;

/** Five Instagram Reels (1080×1920, 30 fps); each one lasts as long as its voiceover plus a 2 s end card. */
export const Root: React.FC = () => (
  <Folder name="Instagram">
    {PROMOS.map((promo) => (
      <Composition key={promo.id} id={promo.id} component={PromoVideo} width={1080} height={1920} fps={FPS}
        durationInFrames={Math.round((promo.voice.end + 2) * FPS)} defaultProps={{ promo }} />
    ))}
  </Folder>
);
