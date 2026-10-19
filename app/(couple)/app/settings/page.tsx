import { AppNav, Brand, Page, StateCard } from "../../../app-ui/shell";
import { SettingsView, type SettingsPageView } from "../../../app-ui/settings";
import { SignInCard } from "../../../app-ui/sign-in";
import { appleSignInConfigured, hontoSource } from "../../../app-ui/web-app-data";
import { loadSettingsView } from "../../../app-ui/web-app-loader.js";

export const dynamic = "force-dynamic";

export const metadata = { title: "Honto · Settings" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const { fixture } = await searchParams;
  const view = await loadSettingsView(await hontoSource(Array.isArray(fixture) ? fixture[0] : fixture)) as SettingsPageView;
  if (view.kind === "signed-out") return <Page narrow><Brand/><SignInCard appleConfigured={appleSignInConfigured()}/></Page>;
  if (view.kind === "unavailable") return <Page narrow><Brand/><StateCard title="Settings are taking a break"><p className="ha-muted">{view.message}</p></StateCard></Page>;
  return <Page>
    <AppNav active="settings" me={view.me}/>
    <SettingsView me={view.me}/>
  </Page>;
}
