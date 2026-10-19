import { DayPanel, MemoriesCalendar, TopBar, type MemoriesPageView } from "../../app-ui/memories";
import { AppNav, Brand, Page, StateCard } from "../../app-ui/shell";
import { SignInCard } from "../../app-ui/sign-in";
import { appleSignInConfigured, hontoSource } from "../../app-ui/web-app-data";
import { loadMemoriesView } from "../../app-ui/web-app-loader.js";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function MemoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const source = await hontoSource(one(params.fixture));
  const view = await loadMemoriesView(source, { month: one(params.month), day: one(params.day) }) as MemoriesPageView;
  if (view.kind === "signed-out") return <Page narrow><Brand/><SignInCard appleConfigured={appleSignInConfigured()}/></Page>;
  if (view.kind === "unavailable") return <Page narrow><Brand/><StateCard title="Memories are taking a break"><p className="ha-muted">{view.message}</p></StateCard></Page>;
  if (view.kind === "unpaired") return <Page><AppNav active="memories" me={view.me}/><StateCard title="Pair with your partner in the app"><p className="ha-muted">Memories fill in once you and your partner are paired. Open Honto on your phone to send or accept an invite.</p></StateCard></Page>;
  return <Page>
    <AppNav active="memories" me={view.me}/>
    <TopBar today={view.today}/>
    <div className="ha-columns">
      <MemoriesCalendar view={view}/>
      <DayPanel view={view}/>
    </div>
  </Page>;
}
