import React, { useEffect, useState } from "react";

import { getPathRotation } from "../../../annotations/rotation";

import { RotationControl } from "./RotationControl";

export function LinkRotationControl({ edgeId }: { edgeId: string }) {
  const [angle, setAngle] = useState<number | null>(null);

  useEffect(() => {
    // Observe the rendered geometry instead of subscribing the panel to every node move.
    // This also handles parallel curves, loops and changes to interface-label layout.
    const path = document.getElementById(edgeId);
    if (!(path instanceof SVGPathElement)) {
      setAngle(null);
      return;
    }
    const update = () => setAngle(getPathRotation(path));
    update();
    const observer = new MutationObserver(update);
    observer.observe(path, { attributes: true, attributeFilter: ["d"] });
    return () => observer.disconnect();
  }, [edgeId]);

  return <RotationControl key={edgeId} objectId={edgeId} angle={angle} />;
}
