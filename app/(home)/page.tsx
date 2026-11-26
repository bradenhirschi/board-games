const GAMES = [
  {
    href: "/stock-market",
    name: "Stock Market",
    blurb: "Buy low, sell high, and race to the target fortune.",
    icon: "/icons/stock-market/icon-192.png",
    className: "pick-stock",
  },
  {
    href: "/plunder",
    name: "Plunder",
    blurb: "Sail, raid islands and hunt for buried treasure.",
    icon: "/icons/plunder/icon-192.png",
    className: "pick-plunder",
  },
];

export default function GamePicker() {
  return (
    <main className="picker">
      <h1>Board Games</h1>
      <p className="picker-sub">Pick a game</p>
      <ul>
        {GAMES.map((game) => (
          <li key={game.href}>
            {/* A plain link: each game has its own root layout, so switching is a full page load anyway. */}
            <a href={game.href} className={`pick ${game.className}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={game.icon} alt="" width={72} height={72} />
              <span>
                <strong>{game.name}</strong>
                <small>{game.blurb}</small>
              </span>
              <b aria-hidden="true">›</b>
            </a>
          </li>
        ))}
      </ul>
      <p className="picker-tip">
        Tip: open a game and add it to your Home Screen to get it as its own app.
      </p>
    </main>
  );
}
