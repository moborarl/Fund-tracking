import json, os
PROJ="/sessions/happy-serene-gates/mnt/Fund value tracking"
def load(p):
    return open(p,encoding="utf-8").read()
navdb=load(PROJ+"/nav_history.json"); holds=load(PROJ+"/holdings.json")
details=load(PROJ+"/fund_details.json") if os.path.exists(PROJ+"/fund_details.json") else "{}"
cfg={"url":"","key":""}
if os.path.exists(PROJ+"/web_config.json"):
    cfg=json.load(open(PROJ+"/web_config.json"))
tpl=load(PROJ+"/template3.html")
def build(hj):
    h=tpl.replace("__HOLDINGS__",hj).replace("__NAVDB__",navdb).replace("__DETAILS__",details)
    h=h.replace("__SB_URL__",cfg.get("url","")).replace("__SB_KEY__",cfg.get("key",""))
    for ph in ("__HOLDINGS__","__NAVDB__","__DETAILS__","__SB_URL__","__SB_KEY__"):
        assert ph not in h, "left "+ph
    return h
personal=build(holds)
for n in ("index.html","KKP_Portfolio_Dashboard.html"):
    open(PROJ+"/"+n,"w",encoding="utf-8").write(personal)
os.makedirs(PROJ+"/web",exist_ok=True)
public=build("{}")
open(PROJ+"/web/index.html","w",encoding="utf-8").write(public)
print("personal",len(personal),"public",len(public),"sb_url_set",bool(cfg.get("url")))
