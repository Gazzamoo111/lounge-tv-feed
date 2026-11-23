import importlib.util
from pathlib import Path
import base64
from datetime import datetime,timezone,timedelta
import gzip,json,tempfile,unittest
import xml.etree.ElementTree as ET

SOURCE=Path(__file__).resolve().parent.parent/'scripts'/'stage_nz_freeview_epg.py'
if not SOURCE.is_file(): SOURCE=Path(__file__).with_name('stage_nz_freeview_epg.py')
SPEC=importlib.util.spec_from_file_location('nz',SOURCE)
nz=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(nz)
T=datetime(2026,11,23,6,10,tzinfo=timezone.utc)

def xmltime(t):return t.strftime('%Y%m%d%H%M%S +0000')

class NZEPGTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); root=Path(self.tmp.name)
  self.cat=root/'catalog';self.epg=root/'epg';self.cat.mkdir();self.epg.mkdir()
  (self.epg/'guide.xml.gz').write_bytes(gzip.compress(b'<tv><channel id="original"><display-name>Original</display-name></channel><programme channel="original" start="20261123050000 +0000" stop="20261123060000 +0000"><title>Old</title></programme></tv>'))
  src=ET.Element('tv');rows=[];blocks=['#EXTM3U\n']
  for sid,(name,guide_id,aliases) in nz.TARGET.items():
   ch=ET.SubElement(src,'channel',id='source-'+str(sid));ET.SubElement(ch,'display-name').text=name
   for step in [0,1]:
    p=ET.SubElement(src,'programme',{'channel':'source-'+str(sid),'start':xmltime(T+timedelta(hours=step)-timedelta(minutes=10)), 'stop':xmltime(T+timedelta(hours=step+1)-timedelta(minutes=10))})
    ET.SubElement(p,'title').text=name+' Original show '+str(step)
   rows.append({'stream_id':sid,'name':name,'category_id':'1','epg_channel_id':''})
   blocks.append(f'#EXTINF:-1 tvg-id="" tvg-name="{name}" group-title="🇳🇿 New Zealand",{name}\n')
   if sid<900000003:blocks.append('#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\n')
   blocks.append(f'{{{{BASE}}}}/live/{{{{USER}}}}/{{{{PASS}}}}/{sid}.mpd\n')
  self.src=root/'freeview.xml.gz';self.src.write_bytes(gzip.compress(ET.tostring(src)))
  (self.cat/'live_all.json').write_text(json.dumps(rows))
  (self.cat/'by-category').mkdir();(self.cat/'by-category/1.json').write_text(json.dumps(rows))
  (self.cat/'template.m3u').write_text(''.join(blocks))
  (self.cat/'live_categories.json').write_text(json.dumps([{'category_id':str(i),'category_name':('🇳🇿 New Zealand' if i==1 else 'Other')} for i in range(1,26)]))
 def tearDown(self):self.tmp.cleanup()
 def test_dry_run_and_appended_real_programmes(self):
  original=(self.cat/'template.m3u').read_bytes()
  d=nz.run(self.cat,self.epg,self.src,T,True)
  self.assertTrue(d['dry_run']);self.assertEqual(original,(self.cat/'template.m3u').read_bytes())
  d=nz.run(self.cat,self.epg,self.src,T,False)
  self.assertFalse(d['dry_run'])
  guide=ET.fromstring(gzip.decompress((self.epg/'guide.xml.gz').read_bytes()))
  self.assertEqual(len(guide.findall('channel')),6);self.assertEqual(len(guide.findall('programme')),11)
  self.assertEqual([x.tag for x in list(guide)[:6]],['channel']*6)
  self.assertEqual(guide.findall('programme')[0].findtext('title'),'Old')
  self.assertEqual((self.cat/'template.m3u').read_text().count('KODIPROP'),2)
  for sid,(_,gid,_) in nz.TARGET.items():
   self.assertIn(gid,[x.attrib['id'] for x in guide.findall('channel')])
   short=json.loads(gzip.decompress((self.epg/f'short/{sid}.json').read_bytes()))
   self.assertEqual(len(short['epg_listings']),2)
 def test_reject_placeholder_sources(self):
  root=nz.load_xml(self.src)
  for p in root.findall('programme'):p.find('title').text='No Data'
  self.src.write_bytes(gzip.compress(ET.tostring(root)))
  with self.assertRaisesRegex(ValueError,'no genuine'):nz.run(self.cat,self.epg,self.src,T,True)
 def test_reject_ambiguous_channel_id(self):
  root=nz.load_xml(self.src)
  c=ET.SubElement(root,'channel',id='ambiguous');ET.SubElement(c,'display-name').text='TVNZ 1'
  self.src.write_bytes(gzip.compress(ET.tostring(root)))
  with self.assertRaisesRegex(ValueError,'expected one exact'):nz.run(self.cat,self.epg,self.src,T,True)

if __name__=='__main__':unittest.main()