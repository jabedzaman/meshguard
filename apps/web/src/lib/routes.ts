const EXIT_NODE_PREFIXES = ["0.0.0.0/0", "::/0"];

export type DeviceRoute = { prefix: string; approved: boolean };

/**
 * A device's routes as one entry each, with the two default routes of an
 * exit node shown as a single "exit node". `prefixes` are what approving it
 * approves.
 */
export function groupRoutes(routes: DeviceRoute[]) {
  const exit = routes.filter((route) => EXIT_NODE_PREFIXES.includes(route.prefix));
  const subnets = routes
    .filter((route) => !EXIT_NODE_PREFIXES.includes(route.prefix))
    .map((route) => ({
      label: route.prefix,
      prefixes: [route.prefix],
      approved: route.approved,
    }));
  return exit.length === 0
    ? subnets
    : [
        {
          label: "exit node",
          prefixes: exit.map((route) => route.prefix),
          approved: exit.every((route) => route.approved),
        },
        ...subnets,
      ];
}
