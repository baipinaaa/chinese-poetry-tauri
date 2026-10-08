/**
 * 诗词列表页：左侧筛选栏 + 诗文列表（筛选 / 分页由 PoemsListClient 客户端组件处理）。
 * 桌面版移植：原 Web 版 app/poems/page.tsx
 *  - SidebarLeftServer（服务端预取）→ SidebarLeft 客户端组件
 *  - 原 app/poems/layout.tsx 的 metadata.title → document.title
 * @author daichangya@163.com
 * https://shi-ci.cn
 */

import { useEffect } from "react";
import LayoutWithSidebar from "../components/LayoutWithSidebar";
import SidebarLeft from "../components/SidebarLeft";
import PoemsListClient from "../components/PoemsListClient";

export default function PoemsPage() {
  useEffect(() => {
    document.title = "诗文";
  }, []);

  return (
    <LayoutWithSidebar sidebarLeft={<SidebarLeft />}>
      <PoemsListClient />
    </LayoutWithSidebar>
  );
}
