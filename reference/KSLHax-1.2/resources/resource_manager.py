from .resources_types import ResourceObject, BackupObject, ConfigurationData

from dotenv import load_dotenv
import shutil
import os

load_dotenv()

class ResourceManager:
    save_location = ResourceObject.global_save_location
    cache_location = "cache/"
    scoring_location = "scoring/"
    backups_location = BackupObject.global_backups_location
    default_image = "assets/DefaultImage.png"
    new_script_location = "assets/new_score_method.py"

    old_data: ResourceObject = ResourceObject("old_data.json", json=True, default="[]")
    blacklist_data: ResourceObject = ResourceObject("blacklist_data.json", json=True, default="[]")
    scored_data: ResourceObject = ResourceObject("scored_data.json", json=True, default="[]")

    offline_mode: bool = os.environ["OFFLINE_MODE"].upper() == 'TRUE'
    clear_cache: bool = os.environ["CLEAR_CACHE"].upper() == 'TRUE'

    configuration_data = ConfigurationData()
    default_scoring_script = BackupObject("default_scoring.py", scoring_location)
    empty_scoring_script = BackupObject("empty_scoring.py", scoring_location)


    @classmethod
    def _verify_cache(cls):
        if not os.path.exists(cls.cache_location):
            os.mkdir(cls.cache_location)
        else:
            if cls.clear_cache:
                shutil.rmtree(cls.cache_location)
                os.mkdir(cls.cache_location)


    @classmethod
    def _verify_saves(cls):
        if not os.path.exists(cls.save_location):
            os.mkdir(cls.save_location)
        cls.configuration_data.safely_restore()
        cls.default_scoring_script.safely_restore()
        cls.empty_scoring_script.safely_restore()


    @classmethod
    def _verify_data(cls):
        files = [cls.old_data, cls.blacklist_data, cls.scored_data]
        for i in files:
            i.verify()


    @classmethod
    def clean_cache(cls):
        files = os.listdir(cls.cache_location)
        files = [cls.cache_location+i for i in files]
        files = sorted(files, key=os.path.getctime)
        while len(files) > 100:
            os.remove(files[0])
            files.pop(0)
            

    @classmethod
    def verify_files(cls):
        cls._verify_cache()
        cls._verify_saves()
        cls._verify_data()
