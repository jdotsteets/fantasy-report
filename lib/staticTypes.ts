export type StaticType =
  | "rankings_ros"
  | "rankings_weekly"
  | "dfs_tools"
  | "projections"
  | "waiver_wire"
  | "stats"
  | "schedule"
  | "draft"
  | "misc"
  | "previews"

export const STATIC_TYPES: StaticType[] = [
  "rankings_ros",
  "rankings_weekly",
  "dfs_tools",
  "projections",
  "waiver_wire",
  "stats",
  "draft",
  "misc",
  "schedule",
  "previews"
];

export function staticTypeLabel(t: StaticType): string {
  switch (t) {
    case "rankings_ros": return "Rankings — ROS";
    case "rankings_weekly": return "Rankings — Weekly";
    case "dfs_tools": return "DFS Tools";
    case "projections": return "Projections";
    case "waiver_wire": return "Waiver Wire";
    case "stats": return "Stats";
    case "draft": return "Draft";
    case "misc": return "Misc";
    case "schedule": return "Schedule";
    case "previews": return "Previews"
  }
}
