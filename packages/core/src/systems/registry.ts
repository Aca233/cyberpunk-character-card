import { type AnySystem, createRegistry } from "../kernel/system";
import { arcs } from "./arcs";
import { braindance } from "./braindance";
import { character } from "./character";
import { chronicle } from "./chronicle";
import { city } from "./city";
import { combat } from "./combat";
import { cyberware } from "./cyberware";
import { dice } from "./dice";
import { economy } from "./economy";
import { factions } from "./factions";
import { fallout } from "./fallout";
import { hacking } from "./hacking";
import { health } from "./health";
import { heat } from "./heat";
import { humanity } from "./humanity";
import { inventory } from "./inventory";
import { jobs } from "./jobs";
import { memory } from "./memory";
import { ncpd } from "./ncpd";
import { nemesis } from "./nemesis";
import { notes } from "./notes";
import { npc } from "./npc";
import { phone } from "./phone";
import { psychosis } from "./psychosis";
import { safehouse } from "./safehouse";
import { shards } from "./shards";
import { sidegigs } from "./sidegigs";
import { squad } from "./squad";
import { stealth } from "./stealth";
import { threads } from "./threads";
import { trauma } from "./trauma";
import { travel } from "./travel";
import { world } from "./world";

/** 所有游戏系统；新系统在这里登记，顺序无关，结算顺序由 dependsOn 决定 */
export const systems: readonly AnySystem[] = [
  dice,
  humanity,
  inventory,
  health,
  character,
  world,
  combat,
  npc,
  economy,
  jobs,
  cyberware,
  heat,
  fallout,
  stealth,
  phone,
  city,
  memory,
  hacking,
  travel,
  factions,
  ncpd,
  trauma,
  safehouse,
  psychosis,
  squad,
  sidegigs,
  notes,
  chronicle,
  nemesis,
  arcs,
  threads,
  braindance,
  shards,
];

export const registry = createRegistry(systems);
