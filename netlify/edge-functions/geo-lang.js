// Netlify Edge Function: picks the visitor's language from their real
// IP-based country (no API key, no third-party service -- Netlify's edge
// network resolves this for free) and stamps it onto the HTML response
// before it reaches the browser.
//
// This runs *before* any client-side JavaScript, so it:
//   1. Sets <html lang="..."> correctly from the first byte.
//   2. Rewrites <title> and the description / Open Graph / Twitter meta
//      tags, so crawlers and link-preview bots (which mostly don't execute
//      JavaScript) see the right language too.
//   3. Injects `window.__NR_LANG__` into <head>, which the page's own
//      inline script (at the end of <body>, see index.html) reads so it
//      doesn't have to re-guess the language -- it only swaps the *visible
//      body* text, which lives in the big translations blob in index.html.
//
// A visitor can override this via the on-page language switcher; that
// writes a "nr_lang" cookie which this function honors on every later visit
// (checked first, before geo).
//
// IMPORTANT: this only runs once the site is actually deployed on Netlify.
// Opening index.html directly (file://) or previewing it on a static host
// without Edge Functions support will never invoke this -- the page's
// client-side script then falls back to the visitor's browser language,
// which still works, just less precisely (see index.html for that logic).

const SUPPORTED = ["sv", "da", "nb", "fi", "en"];

const COUNTRY_TO_LANG = {
  SE: "sv",
  DK: "da",
  NO: "nb",
  FI: "fi",
};

// Keep this in sync with the "meta" block for each language in
// i18n/translations.json -- duplicated here (rather than imported) so this
// function has zero build step and no import-assertion/runtime surprises.
const META = {
  sv: {
    htmlLang: "sv",
    title: "Nordic Rise Agency — TikTok LIVE-byrå | Där kreatörer växer",
    description: "Nordic Rise Agency är en specialistbyrå för TikTok LIVE. Vi hjälper kreatörer att få fler tittare, följare, mer engagemang och coins — helt gratis att gå med.",
    ogTitle: "Nordic Rise Agency — Där kreatörer växer",
    ogDescription: "TikTok LIVE Coaching & Creator Growth för kreatörer som vill växa.",
    ogImageAlt: "Nordic Rise Agency — Där kreatörer växer. TikTok LIVE Coaching & Creator Growth.",
    locale: "sv_SE",
  },
  da: {
    htmlLang: "da",
    title: "Nordic Rise Agency — TikTok LIVE-bureau | Hvor skabere vokser",
    description: "Nordic Rise Agency er et specialistbureau for TikTok LIVE. Vi hjælper skabere med flere seere, følgere, mere engagement og coins — helt gratis at være med.",
    ogTitle: "Nordic Rise Agency — Hvor skabere vokser",
    ogDescription: "TikTok LIVE-coaching & Creator Growth for skabere, der vil vokse.",
    ogImageAlt: "Nordic Rise Agency — Hvor skabere vokser. TikTok LIVE-coaching & Creator Growth.",
    locale: "da_DK",
  },
  nb: {
    htmlLang: "nb",
    title: "Nordic Rise Agency — TikTok LIVE-byrå | Der skapere vokser",
    description: "Nordic Rise Agency er et spesialistbyrå for TikTok LIVE. Vi hjelper skapere med flere seere, følgere, mer engasjement og coins — helt gratis å bli med.",
    ogTitle: "Nordic Rise Agency — Der skapere vokser",
    ogDescription: "TikTok LIVE-coaching og Creator Growth for skapere som vil vokse.",
    ogImageAlt: "Nordic Rise Agency — Der skapere vokser. TikTok LIVE-coaching og Creator Growth.",
    locale: "nb_NO",
  },
  fi: {
    htmlLang: "fi",
    title: "Nordic Rise Agency — TikTok LIVE -toimisto | Missä sisällöntuottajat kasvavat",
    description: "Nordic Rise Agency on TikTok LIVEn erikoistoimisto. Autamme sisällöntuottajia saamaan lisää katsojia, seuraajia, enemmän sitoutumista ja kolikoita — liittyminen on täysin ilmaista.",
    ogTitle: "Nordic Rise Agency — Missä sisällöntuottajat kasvavat",
    ogDescription: "TikTok LIVE -valmennusta ja kasvua sisällöntuottajille, jotka haluavat kasvaa.",
    ogImageAlt: "Nordic Rise Agency — Missä sisällöntuottajat kasvavat. TikTok LIVE -valmennusta ja kasvua.",
    locale: "fi_FI",
  },
  en: {
    htmlLang: "en",
    title: "Nordic Rise Agency — TikTok LIVE Agency | Where Creators Grow",
    description: "Nordic Rise Agency is a specialist agency for TikTok LIVE. We help creators get more viewers, followers, engagement and coins — completely free to join.",
    ogTitle: "Nordic Rise Agency — Where Creators Grow",
    ogDescription: "TikTok LIVE Coaching & Creator Growth for creators who want to grow.",
    ogImageAlt: "Nordic Rise Agency — Where Creators Grow. TikTok LIVE Coaching & Creator Growth.",
    locale: "en_US",
  },
};

function getCookie(request, name) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const match = header.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function resolveLang(request, context) {
  const manual = getCookie(request, "nr_lang");
  if (manual && SUPPORTED.includes(manual)) return manual;

  const countryCode = context.geo && context.geo.country && context.geo.country.code;
  if (countryCode && COUNTRY_TO_LANG[countryCode]) return COUNTRY_TO_LANG[countryCode];
  if (countryCode) return "en"; // a known country, just not SE/DK/NO/FI
  return "sv"; // no geo data at all (e.g. local `netlify dev`) -> default to Swedish
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async (request, context) => {
  const response = await context.next();

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  const lang = resolveLang(request, context);
  const meta = META[lang] || META.sv;

  const rewriter = new HTMLRewriter()
    .on("html", {
      element(el) {
        el.setAttribute("lang", meta.htmlLang);
      },
    })
    .on("head", {
      element(el) {
        el.prepend(
          `<script>window.__NR_LANG__=${JSON.stringify(lang)};window.__NR_LANG_SOURCE__="geo";</script>`,
          { html: true }
        );
      },
    })
    .on("title", {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute("content", meta.description);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute("content", meta.ogTitle);
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute("content", meta.ogDescription);
      },
    })
    .on('meta[property="og:locale"]', {
      element(el) {
        el.setAttribute("content", meta.locale);
      },
    })
    .on('meta[property="og:image:alt"]', {
      element(el) {
        el.setAttribute("content", meta.ogImageAlt);
      },
    })
    .on('meta[name="twitter:title"]', {
      element(el) {
        el.setAttribute("content", meta.ogTitle);
      },
    })
    .on('meta[name="twitter:description"]', {
      element(el) {
        el.setAttribute("content", meta.ogDescription);
      },
    })
    .on('meta[name="twitter:image:alt"]', {
      element(el) {
        el.setAttribute("content", meta.ogImageAlt);
      },
    });

  return rewriter.transform(response);
};

export const config = { path: "/" };
