import chalk from 'chalk'
import db from '../db'
import { askForPassword, askForUsername, defaultFilter, askForFilter } from './questions'
import { setLoginToken, requestNewToken, getBillByMonth, getCheckingBalance, getCheckingTransactions } from './middleware'

export default async function executeNubankFlow(_action = {}) {
  const { args, ...action } = _action
  const username = action.username || await askForUsername()

  if (args && args.yesToAllOnce && !args.password) {
    throw new Error('Nubank Password not defined')
  }

  let record = db.get('nubankTokens')
    .find({ username })
    .value()

  // Deal with expired token
  if (record && (new Date(record.token.refresh_before) < new Date())) {
    db.get('nubankTokens')
      .remove({ username })
      .write()

    record = undefined
  }

  if (record) {
    console.log(chalk.blue(`Using valid NuBank token stored for username ${username}...`))
    setLoginToken(record.token)
  } else {
    const password = (args && args.password) || await askForPassword(username)
    const token = await requestNewToken(username, password)

    db.get('nubankTokens')
      .push({ username, token })
      .write()
  }

  if (action.flowType.id === 'nubank-card') {
    const filter = (args && args.yesToAllOnce) ? defaultFilter() : await askForFilter()
    const { bill } = await getBillByMonth(filter)

    const balance = bill.summary.total_balance ? (-1 * bill.summary.total_balance) / 100 : 0
    const transactions = bill.line_items.map((transaction) => {
      const { index, charges, title } = transaction
      return {
        import_id: transaction.id,
        amount: parseInt(-1 * transaction.amount * 10, 10),
        date: transaction.post_date,
        memo: charges !== 1 ? `${title}, ${index + 1}/${charges}` : title,
      }
    })

    return {
      ...action,
      balance,
      username,
      transactions,
    }
  } else if (action.flowType.id === 'nubank-account') {
    const checkTrans = await getCheckingTransactions()

    const checkBalance = await getCheckingBalance()
    const balance = checkBalance.data.viewer.savingsAccount.currentSavingsBalance.netAmount
    const transactions = checkTrans.data.viewer.savingsAccount.feed.reduce((acc, transaction) => {
      if (transaction.amount) {
        const sign = transaction.__typename !== 'TransferInEvent' ? -1 : +1

        return [
          ...acc,
          {
            import_id: transaction.id,
            amount: parseInt(sign * transaction.amount * 1000, 10),
            date: transaction.postDate,
            memo: `${transaction.title} ${transaction.detail}`,
          },
        ]
      }

      return acc
    }, [])

    return {
      ...action,
      balance,
      username,
      transactions,
    }
  }
}
