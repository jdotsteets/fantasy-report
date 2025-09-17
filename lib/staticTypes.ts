export type StaticType =
  | "rankings_ros"
  | "rankings_weekly"
  | "dfs_tools"
  | "projections"
  | "waiver_wire"
  | "stats"
  | "schedule"
  | "draft"
  | "misc";

export const STATIC_TYPES: StaticType[] = [
  "rankings_ros",
  "rankings_weekly",
  "dfs_tools",
  "projections",
  "waiver_wire",
  "stats",
  "schedule",
  "draft",
  "misc"
];

export function staticTypeLabel(t: StaticType): string {
  switch (t) {
    case "rankings_ros": return "Rankings — ROS";
    case "rankings_weekly": return "Rankings — Weekly";
    case "dfs_tools": return "DFS Tools";
    case "projections": return "Projections";
    case "waiver_wire": return "Waiver Wire";
    case "stats": return "Stats";
    case "schedule": return "Scedule";
    case "draft": return "Draft"
    case "misc": return "Misc"
  }
}
