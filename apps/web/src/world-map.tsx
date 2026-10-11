import type { Rect } from "@repo/types";
import { memo, useId } from "react";
import type { Ref } from "react";

import { PORTAL_COLOURS } from "~/map-model";
import { detailLevel, fitViewBox, zoneLabelSize } from "~/view-box";
import type { ViewBox } from "~/view-box";
import { labelFontSize } from "~/world-map-model";
import type { MapArea, MapPlayer, WorldMapModel } from "~/world-map-model";

type WorldMapProps = {
  /** Everything but the player, worked out once per world. */
  readonly model: WorldMapModel;
  /** Drawn on its own, so following the player redraws only the marker. */
  readonly player: MapPlayer | null;
  /** Every area generated or given up on: `data-state="done"`. */
  readonly done: boolean;
  /** What part of the world shows; the whole of it by default. */
  readonly viewBox?: ViewBox;
  readonly svgRef?: Ref<SVGSVGElement>;
  readonly className?: string;
};

/** The amber of the HUD text; pending areas grey, failed ones red. */
const PLAIN = "#fde68a";
const BRIGHT = "#fffbeb";
const PENDING = "#9ca3af";
const FAILED = "#f87171";
const BACKGROUND = "#0c0a09";
/** Zone names are drawn at least this much larger than area labels. */
const ZONE_LABEL_SCALE = 1.6;

const rectProps = ({ minX, maxX, minZ, maxZ }: Rect) => ({
  x: minX,
  y: minZ,
  width: maxX - minX,
  height: maxZ - minZ,
});

const outlineOf = (area: MapArea): string => {
  if (area.state === "failed") {
    return FAILED;
  }
  if (area.state === "pending") {
    return PENDING;
  }
  return area.entry ? BRIGHT : PLAIN;
};

type LayersProps = {
  readonly model: WorldMapModel;
  /** Prefix of this map's clip path ids, unique on the page. */
  readonly clip: string;
};

/** Zone bands, links and areas with their labels. */
const Layers = ({ model, clip }: LayersProps) => {
  const size = labelFontSize(model.bounds);
  // A label's baseline sits one line into its area, or the clip hides it.
  const inset = size * 0.3;
  return (
    <>
      {model.zones.map(
        (zone) =>
          zone.rect !== null && (
            <rect
              key={zone.id}
              data-zone={zone.id}
              {...rectProps(zone.rect)}
              fill={PLAIN}
              fillOpacity={0.04}
              stroke={PLAIN}
              strokeOpacity={0.3}
              vectorEffect="non-scaling-stroke"
            />
          )
      )}
      {model.links.map((link) => (
        <line
          key={link.id}
          x1={link.from.x}
          y1={link.from.z}
          x2={link.to.x}
          y2={link.to.z}
          stroke={PORTAL_COLOURS[link.kind]}
          strokeOpacity={0.4}
          strokeWidth={1 + Math.log2(link.count) / 2}
          strokeDasharray={`${size} ${size / 2}`}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {model.areas.map((area, index) => {
        const id = `${clip}-${index}`;
        const colour = outlineOf(area);
        return (
          <g key={area.id} data-area={area.id} data-area-state={area.state}>
            {/* On the group, so hovering the label shows it too. */}
            {area.error !== null && <title>{area.error}</title>}
            <clipPath id={id}>
              <rect {...rectProps(area.rect)} />
            </clipPath>
            <rect
              {...rectProps(area.rect)}
              fill={area.state === "failed" ? FAILED : "none"}
              fillOpacity={0.15}
              stroke={colour}
              strokeOpacity={area.state === "generated" ? 0.7 : 0.6}
              strokeDasharray={area.state === "pending" ? "4 3" : undefined}
              vectorEffect="non-scaling-stroke"
            />
            {area.rooms.map((room) => (
              <rect
                key={room.id}
                className="map-detail"
                {...rectProps(room.rect)}
                fill={PLAIN}
                fillOpacity={room.kind === "corridor" ? 0.06 : 0.14}
                stroke={PLAIN}
                strokeOpacity={0.25}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <text
              className="map-detail"
              x={area.rect.minX + inset}
              y={area.rect.minZ + size}
              fontSize={size}
              fill={colour}
              clipPath={`url(#${id})`}
            >
              {area.label}
            </text>
          </g>
        );
      })}
    </>
  );
};

/**
 * Memoised on the model, so a new player position does not reconcile the
 * hundreds of shapes in the layers.
 */
const MapLayers = memo(Layers);

type ZoneNamesProps = {
  readonly model: WorldMapModel;
  /** Width of the view in metres: names grow as the map zooms out. */
  readonly viewWidth: number;
};

/** Each zone's name and progress on its band, readable at any zoom. */
const ZoneNames = ({ model, viewWidth }: ZoneNamesProps) => {
  const base = labelFontSize(model.bounds) * ZONE_LABEL_SCALE;
  return model.zones.map((zone) => {
    if (zone.rect === null) {
      return null;
    }
    const text = `${zone.name} ${zone.built}/${zone.total}`;
    const size = zoneLabelSize(
      viewWidth,
      base,
      zone.rect.maxX - zone.rect.minX,
      text
    );
    return (
      <text
        key={zone.id}
        data-zone-name={zone.id}
        x={zone.rect.minX + size * 0.3}
        y={zone.rect.minZ + size}
        fontSize={size}
        fill={PLAIN}
        fillOpacity={0.8}
      >
        {text}
      </text>
    );
  });
};

/**
 * The whole world from above, north up: zone bands, every area (pending
 * ones dashed, failed ones red), the links between them and the player.
 * Screen y is world z, as on the local map. Shows `viewBox`, the whole world
 * by default. Zoomed out, `data-detail="overview"` hides rooms and area
 * labels (`.map-detail`, in `globals.css`): hidden rather than unmounted, so
 * zooming re-renders none of the area shapes.
 */
const WorldMap = ({
  model,
  player,
  done,
  viewBox,
  svgRef,
  className,
}: WorldMapProps) => {
  // `useId` gives `«r0»`-like ids; a clip path id must be a plain name.
  const clip = `world-map-${useId().replaceAll(/[^\w-]/g, "")}`;
  const size = labelFontSize(model.bounds);
  const fit = fitViewBox(model.bounds);
  const view = viewBox ?? fit;
  const heading =
    player === null
      ? 0
      : (Math.atan2(player.heading.z, player.heading.x) * 180) / Math.PI;
  return (
    <svg
      ref={svgRef}
      role="img"
      aria-label="World map"
      className={className}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      preserveAspectRatio="xMidYMid meet"
      data-state={done ? "done" : "generating"}
      data-detail={detailLevel(view.width)}
      fontFamily="ui-monospace, monospace"
    >
      <rect
        x={fit.x}
        y={fit.y}
        width={fit.width}
        height={fit.height}
        fill={BACKGROUND}
      />
      <MapLayers model={model} clip={clip} />
      <ZoneNames model={model} viewWidth={view.width} />
      {player !== null && (
        <polygon
          points="0.9,0 -0.5,0.55 -0.5,-0.55"
          transform={`translate(${player.position.x} ${player.position.z}) rotate(${heading}) scale(${size * 1.5})`}
          fill={BRIGHT}
        />
      )}
    </svg>
  );
};

export { WorldMap };
