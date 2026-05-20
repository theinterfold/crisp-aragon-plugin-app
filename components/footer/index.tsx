import { PUB_APP_NAME, PUB_BLOG_URL, PUB_SOCIALS_URL, PUB_PROJECT_URL, PUB_CHAIN } from "@/constants";

export const Footer = () => {
  const year = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-t-neutral-800 bg-neutral-50">
      <div className="mx-auto grid w-full max-w-screen-xl grid-cols-1 items-end gap-8 px-6 pb-8 pt-12 md:grid-cols-2">
        <div className="font-mono-label text-[11px] uppercase leading-relaxed tracking-[0.18em] text-neutral-500">
          Open source protocol. Built by Gnosis Guild.
          <br />
          Secret ballots powered by Crisp on Aragon OSx.
        </div>
        <ul className="em-list flex flex-col gap-1 md:items-end">
          <li>
            <a href={PUB_PROJECT_URL} target="_blank" rel="noreferrer">
              {PUB_APP_NAME}
            </a>
          </li>
          <li>
            <a href={PUB_BLOG_URL} target="_blank" rel="noreferrer">
              Blog
            </a>
          </li>
          <li>
            <a href={PUB_SOCIALS_URL} target="_blank" rel="noreferrer">
              X (Twitter)
            </a>
          </li>
        </ul>
      </div>
      <div className="font-mono-label mx-auto flex w-full max-w-screen-xl justify-between border-t border-t-neutral-800 px-6 py-6 text-[11px] uppercase tracking-[0.12em] text-neutral-500">
        <span>
          © {year} {PUB_APP_NAME}
        </span>
        <span>{PUB_CHAIN.name}</span>
      </div>
    </footer>
  );
};
