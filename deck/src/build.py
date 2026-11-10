import re,base64,os,sys
V='';S='../deck2/img/'
rd=lambda f:open(V+f,encoding='utf-8').read()
b64=lambda p,m:'data:%s;base64,'%m+base64.b64encode(open(p,'rb').read()).decode()
css=rd('style.css');slides=rd('slides.html');js=rd('engine.js')
css=re.sub(r'\{\{font:([\w-]+)\}\}',lambda m:b64('fonts/%s.ttf'%m.group(1),'font/ttf'),css)
used=set(re.findall(r'\{\{img:(\w+)\}\}',slides))|{'logo_b','logo_t'}
# static imgs: use shared map via JS to avoid duplicate bytes
slides=re.sub(r'src="\{\{img:(\w+)\}\}"',lambda m:'data-img="%s"'%m.group(1),slides)
imgmap='{'+','.join('%s:"%s"'%(n,b64(S+n+'.webp','image/webp')) for n in sorted(used))+'}'
html=rd('shell.html').replace('{{css}}',css).replace('{{slides}}',slides).replace('{{imgmap}}',imgmap).replace('{{js}}',js)
# hydrate data-img at start
html=html.replace("var S=$$('.sl')","$$('[data-img]').forEach(function(i){i.src=IMG[i.getAttribute('data-img')]});var S=$$('.sl')",1)
open(sys.argv[1],'w',encoding='utf-8').write(html);print(round(len(html)/1e6,2),'MB',len(used),'imgs')
