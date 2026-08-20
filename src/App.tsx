import {
  Refine,
  Authenticated,
} from "@refinedev/core";
import { DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import {
  AuthPage,
  ErrorComponent,
  useNotificationProvider,
  RefineSnackbarProvider,
  ThemedLayoutV2,
} from "@refinedev/mui";

import { dataProvider, liveProvider } from "@refinedev/supabase";
import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import routerBindings, {
  NavigateToResource,
  CatchAllNavigate,
  UnsavedChangesNotifier,
  DocumentTitleHandler,
} from "@refinedev/react-router";
import { MarginCategoryList } from "./pages/marginCategories";
import { IntrastatList } from "./pages/intrastat";
import {
  ProductList,
  ImportCreate,
  ProductShow
} from "./pages/products";
import {
  GeneralConfigsList,
  GeneralConfigsCreate
} from "./pages/generalConfigs";
import {
  ImportBatchList,
  ImportUpload,
  ImportBatchShow
} from "./pages/imports";
import { AppIcon } from "./components/app-icon";
import { supabaseClient } from "./utility";
import { ColorModeContextProvider } from "./contexts/color-mode";
import { Header } from "./components/header";
import authProvider from "./authProvider";

function App() {
  return (
    <BrowserRouter>
      {/* <GitHubBanner /> */}
      <RefineKbarProvider>
        <ColorModeContextProvider>
          <CssBaseline />
          <GlobalStyles styles={{ html: { WebkitFontSmoothing: "auto" } }} />
          <RefineSnackbarProvider>
            <DevtoolsProvider>
              <Refine
                dataProvider={dataProvider(supabaseClient)}
                liveProvider={liveProvider(supabaseClient)}
                authProvider={authProvider}
                routerProvider={routerBindings}
                notificationProvider={useNotificationProvider}
                resources={[
                  {
                    name: "product_flat_table",
                    list: "/products",
                    create: "/products/create",
                    show: "/products/show/:id",
                    meta: {
                      canDelete: true,
                      label: "All Products"
                    },
                  },
                  {
                    name: "imports",
                    list: "/imports",
                    show: "/imports/show/:id",
                    create: "/imports/upload",
                    meta: {
                      label: "Product Import"
                    },
                  },
                  {
                    name: "category_margins",
                    list: "/margin-categories",
                    meta: {
                      label: "Margin Category"
                    },
                  },
                  {
                    name: "intrastat_duty_tax",
                    list: "/intrastat-tax",
                    meta: { idColumnName: "intrastat", label: "Duty Intrastats" },
                  },
                  {
                    name: "config_rates",
                    list: "/general-configs",
                    create: "/general-configs/create",
                    meta: {
                      label: "General Configs"
                    },
                  }
                ]}
                options={{
                  syncWithLocation: true,
                  warnWhenUnsavedChanges: true,
                  useNewQueryKeys: true,
                  liveMode: "off",
                  projectId: "W0Fi2f-Mo7l0v-oNhizO",
                  title: { text: "JLine - PIMS", icon: <AppIcon /> },
                }}
              >
                <Routes>
                  <Route
                    element={
                      <Authenticated
                        key="authenticated-inner"
                        fallback={<CatchAllNavigate to="/login" />}
                      >
                        <ThemedLayoutV2 Header={Header}>
                          <Outlet />
                        </ThemedLayoutV2>
                      </Authenticated>
                    }
                  >
                    <Route
                      index
                      element={<NavigateToResource resource="products" />}
                    />
                    <Route path="/margin-categories">
                      <Route index element={<MarginCategoryList />} />
                    </Route>
                    <Route path="/products">
                      <Route index element={<ProductList />} />
                      <Route path="create" element={<ImportCreate />} />
                      <Route path="show/:id" element={<ProductShow />} />
                    </Route>
                    <Route path="/intrastat-tax">
                      <Route index element={<IntrastatList />} />
                    </Route>
                    <Route path="/general-configs">
                      <Route index element={<GeneralConfigsList />} />
                      <Route path="create" element={<GeneralConfigsCreate />} />
                    </Route>
                    <Route path="/imports">
                      <Route index element={<ImportBatchList />} />
                      <Route path="create" element={<ImportCreate />} />
                      <Route path="upload" element={<ImportUpload />} />
                      <Route path="show/:id" element={<ImportBatchShow />} />
                    </Route>
                    <Route path="*" element={<ErrorComponent />} />
                  </Route>
                  <Route
                    element={
                      <Authenticated
                        key="authenticated-outer"
                        fallback={<Outlet />}
                      >
                        <NavigateToResource />
                      </Authenticated>
                    }
                  >
                    <Route
                      path="/login"
                      element={
                        <AuthPage
                          type="login"
                          registerLink={false}
                          formProps={{
                            defaultValues: {
                              email: "",
                              password: "",
                            },
                          }}
                        />
                      }
                    />
                    {/* <Route
                      path="/register"
                      element={<AuthPage type="register" />}
                    /> */}
                    <Route
                      path="/forgot-password"
                      element={<AuthPage type="forgotPassword" />}
                    />
                  </Route>
                </Routes>

                <RefineKbar />
                <UnsavedChangesNotifier />
                <DocumentTitleHandler />
              </Refine>
              {/* <DevtoolsPanel /> */}
            </DevtoolsProvider>
          </RefineSnackbarProvider>
        </ColorModeContextProvider>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
