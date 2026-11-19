import React from "react";
import { Composition } from "remotion";
import { ShortComposition } from "./ShortComposition";
import { FPS, OUT_H, OUT_W, defaultSpec, durationInFrames, type ShortProps } from "./spec";

/** Composition registry used by the helper's renderer (`npm run worker`). */
export const RemotionRoot: React.FC = () => (
  <Composition
    id="Short"
    component={ShortComposition}
    width={OUT_W}
    height={OUT_H}
    fps={FPS}
    durationInFrames={300}
    defaultProps={{ spec: defaultSpec({ duration: 10, width: 1920, height: 1080 }), videoSrc: "", audioUrls: {} } satisfies ShortProps}
    calculateMetadata={({ props }) => ({ durationInFrames: durationInFrames(props.spec) })}
  />
);
