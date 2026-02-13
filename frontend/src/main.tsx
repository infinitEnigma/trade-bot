/** @format */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WalletProvider from "./shared/components/WalletProvider";
import "./index.css";
//import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </React.StrictMode>
);
