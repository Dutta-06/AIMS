print("Enter file address and column to be encoded in function")

def OneHotEncoder(path,column):
    data = pd.read_csv(path)
    try:
        if column in data.columns:
            print("Column found!")
            if data[column].dtype != 'object':
                print("Column cannot be encoded!")
            else:
                print("Encoding data....")
    except:
        print("Column was not found! Encoding terminated.")
    index = data.columns.get_loc(column)
    categories = list(data[column].unique())
    num_categories = len(categories)
    for i in range(num_categories):
        EncoderList = []
        for j in data[column]:
            if j == categories[i]:
                EncoderList.append(1.0)
            else:
                EncoderList.append(0.0)
        data.insert(index,str(i),EncoderList)
    og_column = input("Retain original column?(y/N)")
    if og_column == 'y':
        print(data)
    else:
        data.drop(column,axis = 1, inplace = True)
        print(data)

def OrdinalEncoder(path,column):
    data = pd.read_csv(path)
    try:
        if column in data.columns:
            print("Column Found!")
        if data[column].dtype == 'object':
            print("Encoding...\n")
        else:
            print("Column cannot be encoded!")
    except:
        print("Column not found!")
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
	

  
  
  
  
