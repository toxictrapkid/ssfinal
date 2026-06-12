class PaginationHelper:
    '''
    Breaks items given
    into separate pages.
    '''
    def __init__(self, collection, items_per_page):
        self.collection = list(self._break_list(collection, items_per_page))
        if len(self.collection) == 0:
            self.collection.append([])
        self.ipp = items_per_page


    def _break_list(self, items, ipp):
        for i in range(0, len(items), ipp): yield items[i:i + ipp]
        

    def item_count(self):
        '''
        Returns the number
        of items within the
        entire collection
        '''
        if len(self.collection) == 0: return 0
        return (len(self.collection[:-1])*self.ipp)+len(self.collection[-1])


    def page_count(self): 
        '''
        Returns the total
        number of pages
        '''
        return len(self.collection)


    def page_item_count(self, page_index):
        '''
        Returns the number of items
        on the page given. The page
        index is 0 based, and will
        return -1 if the page
        does not exist.
        '''
        try:
            return len(self.collection[page_index])
        except IndexError:
            return -1


    def page_index(self, item_index):
        '''
        Determines what page the
        item is on based on the
        index of the item.

        Returns -1 for items
        out of range.
        '''
        if (item_index < 0) or (item_index > (self.item_count()-1)): return -1
        return item_index // self.ipp