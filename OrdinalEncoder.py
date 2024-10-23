def OrdinalEncoder(column):
    try:
        if column in data.columns:
            print("Column Found!")
        if data[column].dtype == 'object':
            print("Encoding...\n")
        else:
            print("Column cannot be encoded!")
    except:
        print("Column not found!")
    if data[column].dtype == 'object': 
        categories = list(data[column].unique())
        RangeList = list(range(len(categories)))
        dict = {}
        for i in categories:
            dict[i] = random.choice(RangeList)
            RangeList.remove(dict[i])
        EncoderList = []
        for j in data[column]:
            EncoderList.append(dict[j])
        data[column] = EncoderList
        print(data)
