"""Public-safe synthetic tests for guarded Lounge TV QA catalogue cleanup."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'scripts'))
from cleanup_qa_catalog import normalize,uk_brand,logical_key,plan_uk,plan_us,reorder_sky,blocks_from_m3u


def row(stream_id,name,epg='',category='3'):
    return {'stream_id':stream_id,'name':name,'epg_channel_id':epg,'category_id':category}


class CleanupTest(unittest.TestCase):
    def test_quality_alias_and_timeshift_remain_distinct(self):
        self.assertEqual(normalize('UK| CHANNEL 4 FHD'),normalize('UK| CHANNEL 4 HEVC FHD'))
        self.assertNotEqual(normalize('UK| CHANNEL 4 FHD'),normalize('UK| CHANNEL 4 +1'))
        self.assertEqual(uk_brand('UK| BBC ONE SCOTLAND HD'),'BBC ONE')
        self.assertIsNone(uk_brand('UK| BBC ONE +1'))
        self.assertIsNone(uk_brand('UK| BBC 4'))

    def test_bbc_uk_selection_prefers_verified_london(self):
        inputs=[row(392911,'UK| BBC ONE LONDON','uk.bbc1'),
                row(229915,'UK| BBC 1','uk.bbc1'),
                row(111558,'UK| BBC ONE SCOTLAND HD','uk.bbc1.scot'),
                row(1014307,'UK| CHANNEL 4 +1','uk.ch4.plus1')]
        hide,decisions=plan_uk(inputs)
        self.assertEqual(hide,{229915})
        self.assertNotIn(111558,hide) # distinct Scotland EPG is protected
        self.assertTrue(all(d['keep_id']==392911 for d in decisions))
        self.assertNotIn(1014307,hide)

    def test_us_main_hd_selected_over_raw(self):
        inputs=[row(45451,'US| FX HD','fx'),row(2151727,'TV| FX ᴿᴬᵂ','fx'),
                row(91852,'US| FX WEST HD','fx.west'),row(45449,'US| FXX HD','fxx')]
        hide,decisions=plan_us(inputs)
        self.assertEqual(hide,{2151727})
        self.assertNotIn(91852,hide) # US WEST has distinct EPG
        self.assertNotIn(45449,hide)
        self.assertTrue(all(d['keep_id']==45451 for d in decisions))

    def test_us_distinct_brand_kept(self):
        inputs=[row(45458,'US| HALLMARK HD','h'),row(2151713,'TV| HALLMARK CHANNEL ᴿᴬᵂ','h'),
                row(90961,'US| HALLMARK FAMILY HD','hf')]
        hide,_=plan_us(inputs)
        self.assertEqual(hide,{2151713})

    def test_sky_raw_block_then_fhd_with_raw8_missing(self):
        first=[row(900000000+i,['TVNZ 1','TVNZ 2','Three','Whakaata Māori','Te Reo'][i-1]) for i in range(1,6)]
        source=[]
        for i in [1,2,3,4,5,6,7,9]:source.append(row(1424319-i,f'NZ| SKY SPORTS NZ {i}'))
        for i in range(1,10):source.append(row(2024779-i,f'NZ| SKY SPORT {i} FHD'))
        source.append(row(1424307,'NZ| SKY NZ ESPN'))
        scrambled=first+[v for pair in zip(source[:8],source[8:]) for v in pair]+source[16:]
        result=reorder_sky(scrambled)
        self.assertEqual([r['stream_id'] for r in result[:5]],[900000001,900000002,900000003,900000004,900000005])
        self.assertEqual([r['stream_id'] for r in result[5:13]],[1424318,1424317,1424316,1424315,1424314,1424313,1424312,1424310])
        self.assertEqual([r['stream_id'] for r in result[13:22]],[2024778,2024777,2024776,2024775,2024774,2024773,2024772,2024771,2024770])
        self.assertEqual(result[-1]['stream_id'],1424307)

    def test_m3u_preserves_nz_drm_block(self):
        m3u='#EXTM3U url-tvg="{{EPG_URL}}"\n#EXTINF:-1 tvg-id="",TVNZ 1\n#KODIPROP:inputstream.adaptive.license_type=com.widevine\n{{BASE}}/live/{{USER}}/{{PASS}}/900000001.mpd\n#EXTINF:-1 tvg-id="ltv.sky",Sky Sport\n{{BASE}}/live/{{USER}}/{{PASS}}/1424318.ts\n'
        header,blocks=blocks_from_m3u(m3u)
        self.assertEqual(len(blocks),2)
        self.assertIn('com.widevine',blocks[900000001])
        self.assertEqual(header,'#EXTM3U url-tvg="{{EPG_URL}}"\n')

if __name__=='__main__':unittest.main()