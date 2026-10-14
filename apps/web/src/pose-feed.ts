import type { Placement } from "@repo/types";

import { createFeed } from "~/feed";
import type { Feed } from "~/feed";

/** Where the player is: the Player publishes, the open maps subscribe. */
type PoseFeed = Feed<Placement>;

const createPoseFeed = (): PoseFeed => createFeed<Placement>();

export { createPoseFeed };
export type { PoseFeed };
