def OneHotEncoder(column):
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
        data.insert(index,data[column][i],EncoderList)
    og_column = input("Retain original column?(y/N)")
    if og_column == 'y':
        print(data)
    else:
        data.drop(column,axis = 1, inplace = True)
        print(data)

