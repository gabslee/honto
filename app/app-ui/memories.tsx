import Link from "next/link";
import type { Me, MemoriesMonth, MemoryDay, MemoryDaySummary, Photo, Today } from "../../contracts/honto-api";
import { Hanko, Icon } from "./icons";
import { PartnerClock } from "./partner-clock";
import { Img } from "./shell";
import {
  cityFromTimeZone, dayCellState, dayNumber, formatLongDay, formatShortDay, formatTime, initial, kanjiMonth, monthGrid,
  monthTitle, partnerStatusLine, photoPhrase, reunionLines, splitDayPhotos, togetherLines,
} from "./web-app-model.js";

export type DayView = { kind: "photos"; day: string; detail: MemoryDay } | { kind: "locked" | "empty" | "error"; day: string };
export type MemoriesView = {
  kind: "ready"; me: Me; today: Today; memories: MemoriesMonth; month: string; todayDay: string;
  selectedDay: string | null; day: DayView | null; previousMonth: string; nextMonth: string | null;
};

export type MemoriesPageView = { kind: "signed-out" } | { kind: "unavailable"; message: string } | { kind: "unpaired"; me: Me } | MemoriesView;

const monthHref = (month: string, day?: string) => `/app?month=${month}${day ? `&day=${day}` : ""}`;

/** Top bar: partner time and status, countdown to the next meeting, days together. */
export function TopBar({ today }: { today: Today }) {
  const partner = today.partner;
  const photo = partner.dailyPhoto ?? partner.latestPhoto;
  const city = cityFromTimeZone(partner.timeZone);
  const status = partnerStatusLine(partner.status, partner.timeZone);
  const reunion = reunionLines(today.reunion);
  const together = togetherLines(today.daysTogether, today.startedOn);
  return <section className={photo?.urls ? "ha-banner has-photo" : "ha-banner"} aria-label="Today">
    {photo?.urls && <Img className="ha-banner-photo" src={photo.urls.full} width={photo.width} height={photo.height} alt="" eager/>}
    <div className="ha-chips">
      <div className="ha-chip">
        <span className="ha-avatar partner" aria-hidden="true">{initial(partner.displayName)}</span>
        <div className="ha-chip-text">
          <strong>{partner.displayName}{city ? ` · ${city}` : ""}</strong>
          <span>
            {partner.timeZone ? <PartnerClock timeZone={partner.timeZone} serverNow={Date.parse(today.generatedAt)}/> : "Time zone not shared yet"}
            {status && <><span aria-hidden="true"> · </span><span className={`ha-dot ${partner.status?.state === "busy" ? "is-busy" : "is-free"}`} aria-hidden="true"/>{status}</>}
          </span>
        </div>
      </div>
      <div className="ha-chip">
        <span className="ha-chip-icon"><Icon name="plane" size={20}/></span>
        <div className="ha-chip-text"><strong>{reunion.title}</strong><span>{reunion.detail}</span></div>
      </div>
      <div className="ha-chip">
        <Hanko size={28}/>
        <div className="ha-chip-text"><strong>{together.title}</strong><span>{together.detail}</span></div>
      </div>
    </div>
  </section>;
}

function cellLabel(day: string, state: string, summary: MemoryDaySummary | null) {
  const date = formatShortDay(day);
  if (state === "locked") return `${date}, Premium`;
  if (state === "photos") return `${date}, ${summary!.photoCount === 1 ? "1 photo" : `${summary!.photoCount} photos`}`;
  return `${date}, no photos`;
}

/** Month calendar: each day shows the partner's thumbnail with mine inset. */
export function MemoriesCalendar({ view }: { view: MemoriesView }) {
  const { memories, month, todayDay, selectedDay, previousMonth, nextMonth } = view;
  const byDay = new Map(memories.days.map((entry) => [entry.day, entry]));
  const free = memories.historyLimitDays != null;
  return <section className="ha-card ha-calendar" aria-labelledby="ha-month-title">
    <header className="ha-calendar-head">
      <h1 id="ha-month-title">{monthTitle(month)} <span className="ha-kanji" lang="ja">{kanjiMonth(month)}</span></h1>
      <nav className="ha-month-nav" aria-label="Change month">
        <Link className="ha-round" href={monthHref(previousMonth)} scroll={false} aria-label="Previous month"><Icon name="chevronLeft" size={18}/></Link>
        <Link className="ha-today" href="/app" scroll={false}>Today</Link>
        {nextMonth ? <Link className="ha-round" href={monthHref(nextMonth)} scroll={false} aria-label="Next month"><Icon name="chevronRight" size={18}/></Link> : <span className="ha-round is-disabled" aria-hidden="true"><Icon name="chevronRight" size={18}/></span>}
      </nav>
    </header>
    <div className="ha-weekdays" aria-hidden="true">{["M", "T", "W", "T", "F", "S", "S"].map((letter, index) => <span key={index}>{letter}</span>)}</div>
    <ol className="ha-grid">
      {monthGrid(month).flat().map((day, index) => {
        if (!day) return <li key={`pad-${index}`} className="ha-cell is-pad" aria-hidden="true"/>;
        const summary = byDay.get(day) ?? null;
        const state = dayCellState({ day, summary, today: todayDay, historyLimitDays: memories.historyLimitDays });
        const classes = ["ha-cell", `is-${state}`, day === todayDay && "is-today", day === selectedDay && "is-selected"].filter(Boolean).join(" ");
        const number = <span className="ha-cell-num">{Number(day.slice(8))}</span>;
        if (state === "future" || state === "empty") return <li key={day}><div className={classes}>{number}</div></li>;
        const main = summary?.partner ?? summary?.me ?? null;
        const inset = summary?.partner && summary?.me ? summary.me : null;
        return <li key={day}>
          <Link className={classes} href={monthHref(month, day)} scroll={false} aria-label={cellLabel(day, state, summary)} aria-current={day === selectedDay ? "date" : undefined}>
            {state === "photos" && main && <Img className="ha-cell-photo" src={main.thumbUrl} width={256} height={256} alt=""/>}
            {state === "photos" && inset && <Img className="ha-cell-inset" src={inset.thumbUrl} width={256} height={256} alt=""/>}
            {state === "locked" && <span className="ha-cell-lock"><Icon name="lock" size={16}/></span>}
            {number}
          </Link>
        </li>;
      })}
    </ol>
    {free && <p className="ha-gate-note"><Icon name="lock" size={14}/>Free shows the last 7 days. Older days open with Premium.</p>}
  </section>;
}

function PhotoFigure({ photo, who, name, timeZone }: { photo: Photo | null; who: "me" | "partner"; name: string; timeZone: string | null }) {
  const phrase = photoPhrase(photo);
  const city = cityFromTimeZone(timeZone);
  return <figure className="ha-photo">
    <div className="ha-photo-frame">
      {photo?.urls
        ? <Img src={photo.urls.full} width={photo.width} height={photo.height} alt={who === "me" ? "Your photo" : `${name}'s photo`}/>
        : <div className="ha-photo-missing"><Icon name="photo" size={22}/><span>No photo</span></div>}
    </div>
    <figcaption>
      <span className="ha-who"><span className={`ha-avatar is-small ${who}`} aria-hidden="true">{initial(name)}</span><strong>{who === "me" ? "You" : name}</strong></span>
      {photo && <span className="ha-meta">{formatTime(photo.createdAt, timeZone)}{city ? ` · ${city}` : ""}</span>}
      {phrase && ("ja" in phrase
        ? <span className="ha-phrase"><span className="ha-ja" lang="ja">{phrase.ja}</span><span className="ha-romaji">{phrase.romaji}</span><span className="ha-translation">{phrase.translation}</span></span>
        : <span className="ha-phrase-text">{phrase.text}</span>)}
    </figcaption>
  </figure>;
}

/** The open day: both photos large with the phrase, or the upgrade card when Free reaches the 7-day limit. */
export function DayPanel({ view }: { view: MemoriesView }) {
  const { day, me, today } = view;
  if (!day) return <section className="ha-card ha-day is-empty"><p className="ha-muted">Pick a day to open it.</p></section>;
  const number = dayNumber(today.startedOn, day.day);
  const partnerName = today.partner.displayName;
  return <section className="ha-card ha-day" aria-labelledby="ha-day-title" aria-live="polite">
    {number != null && <p className="ha-caption">Day {number.toLocaleString("en-US")}</p>}
    <h2 id="ha-day-title">{formatLongDay(day.day)}</h2>
    {day.kind === "photos" && (() => {
      const { partner, me: mine, extras } = splitDayPhotos(day.detail.photos);
      return <>
        <div className="ha-pair">
          <PhotoFigure photo={partner} who="partner" name={partnerName} timeZone={today.partner.timeZone}/>
          <PhotoFigure photo={mine} who="me" name={me.user.displayName} timeZone={today.me.timeZone}/>
        </div>
        {extras.length > 0 && <div className="ha-more">
          <span className="ha-more-thumbs">{extras.slice(0, 3).map((photo) => <Img key={photo.id} src={photo.urls!.thumb} width={40} height={40} alt=""/>)}</span>
          <span>{extras.length === 1 ? "1 more from this day" : `${extras.length} more from this day`}</span>
        </div>}
      </>;
    })()}
    {day.kind === "locked" && <div className="ha-upgrade">
      <Hanko size={36}/>
      <h3>Older memories are part of Premium</h3>
      <p>Free keeps your last 7 days. Upgrade in the Honto app on your phone to open every day, here and in the app.</p>
    </div>}
    {day.kind === "empty" && <p className="ha-muted">No photos this day.</p>}
    {day.kind === "error" && <p className="ha-muted" role="status">This day did not load. Try again in a moment.</p>}
    <p className="ha-footnote">Read-only on the web. Photos are posted from the app.</p>
  </section>;
}
