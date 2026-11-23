import importlib.util
import pathlib
import unittest

PATH=pathlib.Path(__file__).resolve().parents[1]/'scripts'/'curate_qa_catalog.py'
spec=importlib.util.spec_from_file_location('curation',PATH)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class CatalogueRulesTests(unittest.TestCase):
 def test_20_approved_distinct_labels(self):
  self.assertEqual(len(mod.CATEGORIES),20)
  self.assertEqual(len({x[0] for x in mod.CATEGORIES}),20)
  approved=('New Zealand','Australia','UK TV & Entertainment','UK Sports','US TV & Entertainment','US Sports','Sports Networks','Streaming Services','Movie Channels','Kids and Family','Documentaries and Lifestyle','FAST TV','Music','24/7 Movies','24/7 Series','24/7 Comedy & Reality','24/7 Drama & Crime','24/7 Streaming & OnePlay','24/7 Kids & Cartoons','Live Events')
  self.assertEqual(tuple(name.split(' ',1)[-1] for name,_ in mod.CATEGORIES),approved)
 def test_every_original_group_classified(self):
  assignments=[group for _,groups in mod.CATEGORIES for group in groups]
  self.assertEqual(set(assignments),set(range(1,38)))
  self.assertEqual(len(assignments),37)
 def test_intentional_order(self):
  self.assertTrue(mod.CATEGORIES[0][0].startswith('🇳🇿'))
  self.assertTrue(mod.CATEGORIES[1][0].startswith('🇦🇺'))
  self.assertTrue(mod.CATEGORIES[-1][0].startswith('🏆'))
  self.assertEqual(mod.CATEGORIES[2][0],'🇬🇧 UK TV & Entertainment')
  self.assertEqual(mod.CATEGORIES[3][0],'🇬🇧 UK Sports')
  self.assertEqual(mod.CATEGORIES[4][0],'🇺🇸 US TV & Entertainment')
  self.assertEqual(mod.CATEGORIES[5][0],'🇺🇸 US Sports')
 def test_split_streaming_from_fast(self):
  self.assertEqual(mod.category_for({'category_id':'18','name':'PRIME| BAYWATCH'}),12)
  self.assertEqual(mod.category_for({'category_id':'18','name':'TV| MOVIE CHANNEL'}),12)
  self.assertEqual(mod.category_for({'category_id':'18','name':'UK| NETFLIX SERIES 4'}),8)
 def test_sports_and_24_7_merges(self):
  self.assertEqual(mod.category_for({'category_id':'3','name':'NZ| SKY SPORT 1'}),1)
  self.assertEqual(mod.category_for({'category_id':'4','name':'NZ| SKY SPORT 2'}),1)
  self.assertEqual(mod.category_for({'category_id':'27','name':'24/7 CRIME'}),17)
  self.assertEqual(mod.category_for({'category_id':'28','name':'24/7 CRIME'}),17)
  self.assertEqual(mod.category_for({'category_id':'29','name':'24/7 ACTION'}),17)
  self.assertEqual(mod.category_for({'category_id':'37','name':'PPV EVENT'}),20)
 def test_cross_market_split_without_losing_channels(self):
  self.assertEqual(mod.category_for({'category_id':'11','name':'UK| ALIBI FHD'}),3)
  self.assertEqual(mod.category_for({'category_id':'11','name':'US| HBO PREMIUM'}),5)
  self.assertEqual(mod.category_for({'category_id':'17','name':'AU| ABC NEWS'}),2)
  self.assertEqual(mod.category_for({'category_id':'20','name':'US| ESPN 2 HD'}),7)
  self.assertEqual(mod.category_for({'category_id':'20','name':'US| UFC LIVE'}),6)
  self.assertEqual(mod.category_for({'category_id':'2','name':'4K| SKY SPORTS UHD'}),7)
  self.assertEqual(mod.category_for({'category_id':'32','name':'EN| ONEPLAY ANIME'}),18)
 def test_hide_dividers_and_info_only(self):
  for value in ('##### GENERAL #####','####### 9NOW RAW #######','## MAX ESPN ##','UK| NETFLIX SERIES info HD','UK| SKY STORE INFO HD','NBA REPLAY INFO HD'):
   self.assertTrue(mod.hidden_reason(value),value)
  for value in ('NZ| SKY SPORT 1 FHD','US| ABC 12 BOSTON','UK| BBC 1','PRIME| FIFA','24/7 FAMILY GUY'):
   self.assertEqual(mod.hidden_reason(value),'',value)
 def test_fail_closed_unknown_category(self):
  with self.assertRaises(ValueError):
   mod.category_for({'category_id':'999','name':'Unknown'})

if __name__=='__main__':unittest.main()
