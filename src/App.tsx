/**
 * 路由表 + 全局布局（对应原 Next.js app/layout.tsx）。
 *
 * 原 layout 的 <html>/<head>/metadata/字体加载 已迁到 index.html 与各页面的 document.title；
 * 这里只负责 Nav + 主内容 + Footer 的骨架，以及路由到各页面组件。
 */

import { Route, Routes } from "react-router-dom";
import DbGate from "./components/DbGate";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import HomePage from "./pages/HomePage";
import PoemsPage from "./pages/PoemsPage";
import RandomPage from "./pages/RandomPage";
import PoemDetailPage from "./pages/PoemDetailPage";
import AuthorsPage from "./pages/AuthorsPage";
import AuthorDetailPage from "./pages/AuthorDetailPage";
import DynastiesPage from "./pages/DynastiesPage";
import TagsPage from "./pages/TagsPage";
import RhythmicsPage from "./pages/RhythmicsPage";
import ContributePage from "./pages/ContributePage";

export default function App() {
  return (
    // DbGate：桌面包里数据库可能尚未导入，先过门禁再渲染路由
    <DbGate>
      <div className="flex min-h-screen flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/poems" element={<PoemsPage />} />
            {/* /poems/random 必须声明在 /poems/:slug 之前，否则会被 :slug 抢走 */}
            <Route path="/poems/random" element={<RandomPage />} />
            <Route path="/poems/:slug" element={<PoemDetailPage />} />
            <Route path="/authors" element={<AuthorsPage />} />
            <Route path="/authors/:slug" element={<AuthorDetailPage />} />
            <Route path="/dynasties" element={<DynastiesPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/rhythmics" element={<RhythmicsPage />} />
            <Route path="/contribute" element={<ContributePage />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </DbGate>
  );
}
