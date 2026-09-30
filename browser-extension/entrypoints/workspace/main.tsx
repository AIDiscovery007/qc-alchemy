import ReactDOM from "react-dom/client";
import App from "../popup/App";
import { GenerationEffectContext } from "../popup/GenerationPanel";
import GenerationEffect from "./GenerationEffect";
import "../popup/style.css";
import "./workspace.css";
import "./project-library.css";
import "./results.css";

document.documentElement.classList.add("embedded", "workspace-page");
ReactDOM.createRoot(document.getElementById("root")!).render(<GenerationEffectContext value={GenerationEffect}><App workspace /></GenerationEffectContext>);
import "../popup/settings-center.css";
