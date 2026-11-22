import importlib.util
import pathlib
import unittest

PATH=pathlib.Path(__file__).resolve().parents[1]/'scripts'/'curate_qa_catalog.py'
spec=importlib.util.spec_from_file_location('curation',PATH)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class CatalogueRulesTests(unittest.TestCase):
 def test_25_nonempty_distinct_labels(self):
  self.assertEqual(len(mod.CATEGORIES),25)
  self.assertEqual(len({x[0] for x in mod.CATEGORIES}),25)
 def test_every_original_group_classified(self):
  assignments=[group for _,groups in mod.CATEGORIES for group in groups]
  self.assertEqual(set(assignments),set(range(1,38)))
  self.assertEqual(len(assignments),37)
 def test_intentional_order(self):
  self.assertTrue(mod.CATEGORIES[0][0].startswith('🇳🇿'))
  self.assertTrue(mod.CATEGORIES[1][0].startswith('🇦🇺'))
  self.assertTrue(mod.CATEGORIES[-1][0].startswith('🏆'))
 def test_split_streaming_from_fast(self):
  self.assertEqual(mod.category_for({'category_id':'18','name':'PRIME| BAYWATCH'}),15)
  self.assertEqual(mod.category_for({'category_id':'18','name':'TV| MOVIE CHANNEL'}),15)
  self.assertEqual(mod.category_for({'category_id':'18','name':'UK| NETFLIX SERIES 4'}),14)
 def test_sports_and_24_7_merges(self):
  self.assertEqual(mod.category_for({'category_id':'3','name':'NZ| SKY SPORT 1'}),1)
  self.assertEqual(mod.category_for({'category_id':'4','name':'NZ| SKY SPORT 2'}),1)
  self.assertEqual(mod.category_for({'category_id':'27','name':'24/7 CRIME'}),20)
  self.assertEqual(mod.category_for({'category_id':'28','name':'24/7 CRIME'}),20)
  self.assertEqual(mod.category_for({'category_id':'29','name':'24/7 ACTION'}),20)
  self.assertEqual(mod.category_for({'category_id':'37','name':'PPV EVENT'}),25)
 def test_hide_dividers_and_info_only(self):
  for value in ('##### GENERAL #####','####### 9NOW RAW #######','## MAX ESPN ##','UK| NETFLIX SERIES info HD','UK| SKY STORE INFO HD','NBA REPLAY INFO HD'):
   self.assertTrue(mod.hidden_reason(value),value)
  for value in ('NZ| SKY SPORT 1 FHD','US| ABC 12 BOSTON','UK| BBC 1','PRIME| FIFA','24/7 FAMILY GUY'):
   self.assertEqual(mod.hidden_reason(value),'',value)
 def test_fail_closed_unknown_category(self):
  with self.assertRaises(ValueError):
   mod.category_for({'category_id':'999','name':'Unknown'})

if __name__=='__main__':unittest.main()
