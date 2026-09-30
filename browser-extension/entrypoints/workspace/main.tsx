import ReactDOM from "react-dom/client";
import App from "../popup/App";
import "../popup/style.css";
import "./workspace.css";
import "./project-library.css";
import "./results.css";

document.documentElement.classList.add("embedded", "workspace-page");
ReactDOM.createRoot(document.getElementById("root")!).render(<App workspace />);
import "../popup/settings-center.css";
