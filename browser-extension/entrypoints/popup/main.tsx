import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";

document.documentElement.classList.toggle(
  "embedded",
  new URLSearchParams(location.search).has("view"),
);
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
