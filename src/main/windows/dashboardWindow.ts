// src/main/windows/dashboardWindow.ts
import { makeSingletonWindow } from "./singletonWindow";

const dashboard = makeSingletonWindow({ width: 760, height: 560, title: "Corujinha — Dashboard", route: "dashboard" });
export const openDashboardWindow = dashboard.open;
