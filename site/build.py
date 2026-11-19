"""Build the static landing page from src.html.

Writes index.html, privacy.html, chungi-face.svg and pet/*.svg into out_dir
(site/dist by default). Phone screens are app mockup screens, with their bag and
gift box drawings inlined. Run: python3 site/build.py [out_dir]

Environment:
  CHUNGI_SIGNUP_API   where the waitlist form posts (default http://localhost:3090/api/signup)
  UMAMI_SRC, UMAMI_WEBSITE_ID   add an Umami script tag only when both are set (default off)
"""
import html, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
PET = os.path.join(ROOT, "assets", "pet")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "dist")
SIGNUP_API = os.environ.get("CHUNGI_SIGNUP_API", "http://localhost:3090/api/signup")
UMAMI_SRC = os.environ.get("UMAMI_SRC", "")
UMAMI_ID = os.environ.get("UMAMI_WEBSITE_ID", "")
ANALYTICS = (f'<script defer src="{html.escape(UMAMI_SRC)}" data-website-id="{html.escape(UMAMI_ID)}"></script>'
             if UMAMI_SRC and UMAMI_ID else "")
INK, KRAFT, KRAFT_DARK, ACCENT = "#2B2724", "#F4DDC0", "#E3A469", "#F08A3C"
POSES = ["chef-happy", "chef-neutral", "happy", "hooray", "notepad", "surprised"]


def pet(name):
    return f"pet/chungi-{name}.svg"


def bag(size, fill=KRAFT_DARK):
    h = round(size * 46 / 40)
    return (f'<svg aria-hidden="true" width="{size}" height="{h}" viewBox="0 0 40 46" style="flex-shrink:0">'
            f'<path d="M14 13V9a6 6 0 0 1 12 0v4" fill="none" stroke="{INK}" stroke-width="2.5" stroke-linecap="round"/>'
            f'<path d="M6 13h28l-2 30H8z" fill="{fill}" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/>'
            f'<path d="M12 21h16" stroke="{INK}" stroke-width="2" stroke-linecap="round" opacity=".35"/></svg>')


BAG_JS = """(function(){var k=0;return function(f){k++;var id='bc'+k,y=13+30*(1-f);
return '<svg width="40" height="46" viewBox="0 0 40 46">'+
'<defs><clipPath id="'+id+'"><path d="M6 13h28l-2 30H8z"/></clipPath></defs>'+
'<path d="M14 13V9a6 6 0 0 1 12 0v4" fill="none" stroke="%(ink)s" stroke-width="2.5" stroke-linecap="round"'+(f<1?' opacity=".4"':'')+'/>'+
'<path d="M6 13h28l-2 30H8z" fill="%(kraft)s"/>'+
'<rect x="0" y="'+y+'" width="40" height="46" fill="%(dark)s" clip-path="url(#'+id+')"/>'+
'<path d="M6 13h28l-2 30H8z" fill="none" stroke="%(ink)s" stroke-width="2.5" stroke-linejoin="round"'+(f<1?' stroke-dasharray="4 3"':'')+'/>'+
(f<1?'':'<path d="M12 21h16" stroke="%(ink)s" stroke-width="2" stroke-linecap="round" opacity=".35"/>')+'</svg>';};})()""" % {
    "ink": INK, "kraft": KRAFT, "dark": KRAFT_DARK}


def giftbox(size):
    return (f'<svg aria-hidden="true" width="{size}" height="{size}" viewBox="0 0 200 200" style="display:block;overflow:visible">'
            f'<ellipse cx="100" cy="188" rx="78" ry="8" fill="rgba(43,39,36,0.16)"/>'
            f'<rect x="32" y="94" width="136" height="90" rx="8" fill="#FFD6A0" stroke="{INK}" stroke-width="3"/>'
            f'<rect x="88" y="94" width="24" height="90" fill="{ACCENT}" stroke="{INK}" stroke-width="3"/>'
            f'<g class="lid">'
            f'<path d="M100 66C86 34 58 34 64 54c3 9 20 12 36 12zM100 66c14-32 42-32 36-12-3 9-20 12-36 12z" fill="{ACCENT}" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>'
            f'<rect x="22" y="64" width="156" height="34" rx="8" fill="#FFC27A" stroke="{INK}" stroke-width="3"/>'
            f'<rect x="88" y="64" width="24" height="34" fill="{ACCENT}" stroke="{INK}" stroke-width="3"/>'
            f'</g></svg>')


GIFT_ICON = (f'<svg aria-hidden="true" width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round">'
             f'<rect x="5" y="13" width="20" height="13" rx="2" fill="#FFD6A0"/><rect x="3" y="9" width="24" height="5" rx="2" fill="#FFC27A"/>'
             f'<path d="M15 9v17"/><path d="M15 9c-2-5-7-6-7-3s4 3 7 3zm0 0c2-5 7-6 7-3s-4 3-7 3z" fill="{ACCENT}"/></svg>')
TICK = ('<svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12.5" fill="#F08A3C" stroke="#2B2724" stroke-width="2.5"/>'
        '<path d="M8.5 14.5l3.5 3.5 7-8" fill="none" stroke="#2B2724" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>')
TICK_SM = ('<svg aria-hidden="true" width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="#2B2724" stroke-width="2.4" '
           'stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>')
PLUS = ('<svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#2B2724" stroke-width="2.6" '
        'stroke-linecap="round"><path d="M4 11h14M11 4v14"/></svg>')
BACK = ('<span class="icon-btn" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 22 22"><path d="M13.5 4.5L7 11l6.5 6.5" fill="none" '
        'stroke="#2B2724" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>')
TAIL_L = ('<svg class="tail-l" aria-hidden="true" width="20" height="28" viewBox="0 0 20 28"><path d="M18 2 L2 14 L18 26" fill="#FFFCF6" '
          'stroke="#2B2724" stroke-width="2.5" stroke-linejoin="round"/><rect x="17" y="3" width="4" height="22" fill="#FFFCF6"/></svg>')


def tail_d(left):
    return (f'<svg class="tail-d" aria-hidden="true" width="28" height="18" viewBox="0 0 28 18" style="left:{left}"><path d="M2 0 L14 15 L26 0" '
            f'fill="#FFFCF6" stroke="#2B2724" stroke-width="2.5" stroke-linejoin="round"/><rect x="3" y="-2" width="22" height="3" fill="#FFFCF6"/></svg>')


def phone(label, inner, extra=""):
    return f'<div class="phone"><div class="stage"><section class="scr"{extra} aria-label="{label}">{inner}</section></div></div>'


def join(where):
    return (f'<div class="join" id="join-{where}" data-where="{where}">'
            f'<form novalidate><input id="in-{where}" name="contact" type="text" inputmode="email" autocomplete="email" placeholder="Email or phone number" aria-label="Email or phone number">'
            f'<button class="btn" type="submit" data-umami-event="waitlist-click-{where}">Join the waitlist</button></form>'
            f'<div class="busy" aria-hidden="true"><i></i></div><p class="msg" role="status" aria-live="polite"></p></div>')


PHONES = {
    "budget": phone("Set your takeout budget", f"""
  <img class="pet" src="{pet('notepad')}" alt="chungi holding a notepad" style="left:12px;top:46px;width:112px;height:129px">
  <div class="bubble" style="left:134px;right:20px;top:66px"><p>how much takeout do you want each month?</p>{TAIL_L}</div>
  <div class="abs" style="left:20px;right:20px;top:214px;text-align:center">
    <div class="big" id="b-amt" style="font-size:88px">$150</div>
    <div class="label" style="margin-top:8px">a month</div>
  </div>
  <div class="track" id="track">
    <div class="fill" id="fill"></div>
    <div class="thumb" id="thumb" role="slider" tabindex="0" aria-label="Monthly takeout budget" aria-valuemin="25" aria-valuemax="300" aria-valuenow="150" aria-valuetext="$150"><i></i><i></i><i></i></div>
  </div>
  <div class="meter-row mono" style="top:440px;left:30px;right:30px;color:var(--p-soft)"><span>$25</span><span>$300</span></div>
  <div class="card bags">
    <div class="bag-grid" id="bag-grid" aria-hidden="true"></div>
    <div class="label" id="b-orders">about 6 orders at $25</div>
  </div>
  <span class="cta still" aria-hidden="true">Set budget</span>"""),

    "status": phone("Takeout budget this month", f"""
  {BACK}<h2 class="h1">october</h2>
  <div class="abs" style="left:20px;right:20px;top:136px;text-align:center">
    <div class="big" style="font-size:64px">$68.00</div>
    <div class="label" style="margin-top:8px">left for takeout</div>
  </div>
  <div class="meter" style="top:248px"><i style="width:54.67%"></i></div>
  <div class="meter-row mono" style="top:292px"><span>$82.00 spent</span><span>$150.00</span></div>
  <ul class="rows" style="top:334px">
    <li>{bag(28)}<span class="name"><b>Burger Barn</b><span>Oct 14</span></span><span class="amt mono">$24.60</span></li>
    <li>{bag(28)}<span class="name"><b>Sushi Go</b><span>Oct 9</span></span><span class="amt mono">$31.20</span></li>
    <li>{bag(28)}<span class="name"><b>Pho Saigon Hut</b><span>Oct 3</span></span><span class="amt mono">$26.20</span></li>
  </ul>
  <img class="pet idle" src="{pet('chef-happy')}" alt="chungi in his chef hat, smiling" style="left:14px;top:574px;width:140px;height:161px">
  <div class="bubble" style="left:156px;right:20px;top:596px"><p>you've saved $243.21 with eleven dinners at home</p>{TAIL_L}</div>"""),

    "close": phone("Close to the takeout budget", f"""
  {BACK}<h2 class="h1">october</h2>
  <div class="meter" style="top:132px"><i style="width:80%"></i></div>
  <div class="meter-row mono" style="top:176px"><span>$120.00 spent</span><span>$150.00</span></div>
  <ul class="rows" style="top:214px">
    <li class="new">{bag(28, ACCENT)}<span class="name"><b>Pho Saigon Hut</b><span>today</span></span><span class="amt mono">$38.00</span></li>
  </ul>
  <div class="bubble" style="left:20px;right:20px;top:322px;padding:18px 22px"><p style="font-size:22px">you've got $30 of takeout left for october. want to cook tonight?</p>{tail_d('54%')}</div>
  <img class="pet idle" src="{pet('chef-neutral')}" alt="chungi in his chef hat, ready to cook" style="left:104px;top:470px;width:220px;height:253px">
  <span class="cta still" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2B2724" stroke-width="2.4" stroke-linejoin="round"><path d="M3.5 8.5h3.2l1.6-2.5h7.4l1.6 2.5h3.2v10h-17z"/><circle cx="12" cy="13.2" r="3.4"/></svg>Cook tonight</span>"""),

    "monthend": phone("October is over", f"""
  <div class="bubble" style="left:20px;right:20px;top:60px;padding:18px 22px"><p style="font-size:21px">october's done! you had $30 of takeout left, so now it's gift money</p>{tail_d('20%')}</div>
  <img class="pet idle" src="{pet('hooray')}" alt="chungi cheering with both flippers up" style="left:6px;top:186px;width:132px;height:152px">
  <div class="abs" style="left:134px;top:200px;width:240px;height:240px">{giftbox(240)}</div>
  <div class="abs" style="left:20px;right:20px;top:470px;text-align:center">
    <div class="big" style="font-size:72px">$30.00</div>
    <div class="label" style="margin-top:10px">gift money</div>
  </div>
  <div class="meter" style="top:612px"><i style="width:80%"></i></div>
  <div class="meter-row mono" style="top:656px"><span>$120.00 spent</span><span>$150.00</span></div>
  <span class="cta still" aria-hidden="true">{GIFT_ICON}Send a gift</span>"""),

    "send": phone("Send a gift", f"""
  {BACK}<h2 class="h1" style="font-size:26px">send a gift</h2>
  <div class="pill">{GIFT_ICON}<span>$30.00</span></div>
  <ul class="people" id="people"></ul>
  <div class="card stepper">
    <button type="button" class="stp raised" id="minus" aria-label="Five dollars less"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#2B2724" stroke-width="3" stroke-linecap="round"><path d="M4 11h14"/></svg></button>
    <div class="big" id="g-amt" style="font-size:60px" aria-live="polite">$10</div>
    <button type="button" class="stp raised" id="plus" aria-label="Five dollars more"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#2B2724" stroke-width="3" stroke-linecap="round"><path d="M4 11h14M11 4v14"/></svg></button>
  </div>
  <img class="pet" id="g-pet" src="{pet('happy')}" alt="chungi smiling" style="left:12px;top:574px;width:118px;height:136px">
  <div class="bubble" style="left:138px;right:20px;top:590px"><p id="g-line" aria-live="polite">who's getting it?</p>{TAIL_L}</div>
  <button type="button" class="cta" id="send" disabled>Pick a friend</button>"""),

    "receive": phone("A gift from jordan", f"""
  <img class="pet" id="r-pet" src="{pet('surprised')}" alt="chungi looking surprised" style="left:14px;top:50px;width:112px;height:129px">
  <div class="bubble" style="left:134px;right:20px;top:74px"><p id="r-line" aria-live="polite">jordan sent you a gift!</p>{TAIL_L}</div>
  <div class="coin" style="top:196px">
    <div class="big" style="font-size:72px">$15.00</div>
    <div class="label" style="margin-top:10px;display:flex;align-items:center;justify-content:center;gap:8px"><span class="av" style="width:30px;height:30px;font-size:15px;background:#FFD6A0">J</span>from jordan</div>
  </div>
  <button type="button" class="gift" id="r-box" aria-label="Open the gift from jordan" style="left:55px;top:360px;width:280px;height:280px">{giftbox(280)}</button>
  <button type="button" class="cta" id="r-cta">Open gift</button>""", ' id="recv"'),
}


def face_svg():
    s = open(os.path.join(PET, "chungi.svg")).read().strip()
    inner = re.sub(r"</svg>\s*$", "", re.sub(r"^<svg[^>]*>", "", s))
    cx, cy, r = 510, 370, 310
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{cx-r-12} {cy-r-12} {2*r+24} {2*r+24}">'
            f'<defs><clipPath id="f"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath></defs>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#BCD2B0"/>'
            f'<g clip-path="url(#f)"><g transform="translate(0 40)">{inner}</g></g>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#2B2724" stroke-width="22"/></svg>')


src = open(os.path.join(HERE, "src.html")).read()
src = re.sub(r"\{\{phone:(\w+)\}\}", lambda m: PHONES[m.group(1)], src)
src = re.sub(r"\{\{join:(\w+)\}\}", lambda m: join(m.group(1)), src)
src = re.sub(r"\{\{pet-js:([\w-]+)\}\}", lambda m: json.dumps(pet(m.group(1))), src)
src = re.sub(r"\{\{bag:(\d+)\}\}", lambda m: bag(int(m.group(1))), src)
src = src.replace("{{analytics}}", ANALYTICS).replace("{{signup-api}}", json.dumps(SIGNUP_API))
src = (src.replace("{{gifticon}}", GIFT_ICON).replace("{{bagjs}}", BAG_JS).replace("{{plus}}", PLUS)
          .replace("{{tick-sm}}", TICK_SM.replace("'", "\\'")).replace("{{tick}}", TICK.replace("'", "\\'")))
assert "{{" not in src, re.findall(r"\{\{[^}]*\}\}", src)[:5]

os.makedirs(os.path.join(OUT, "pet"), exist_ok=True)
for p in POSES:
    shutil.copy(os.path.join(PET, f"chungi-{p}.svg"), os.path.join(OUT, "pet", f"chungi-{p}.svg"))
open(os.path.join(OUT, "chungi-face.svg"), "w").write(face_svg())
open(os.path.join(OUT, "index.html"), "w").write(src)
shutil.copy(os.path.join(HERE, "privacy.html"), os.path.join(OUT, "privacy.html"))
print("wrote", OUT, len(src), "bytes")
